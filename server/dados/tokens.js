// Os links de uso unico que vao por e-mail.
//
// Dois tipos:
//   'verificar' - confirma que o e-mail e da pessoa mesmo
//   'recuperar' - permite definir uma senha nova sem saber a antiga
//
// TRES CUIDADOS, e cada um fecha uma porta diferente:
//
//   1. GUARDAMOS O HASH, NUNCA O TOKEN. E a mesma logica da senha: se o banco
//      vazar, o que esta la dentro nao abre nada, porque o valor que chega pelo
//      e-mail e o original. Sem isso, um vazamento viraria acesso a todas as
//      contas com link pendente.
//
//   2. USO UNICO. Ao ser consumido o token e marcado como usado. Um link de
//      recuperacao que ficou no historico do navegador, ou num e-mail
//      encaminhado sem querer, nao serve uma segunda vez.
//
//   3. VALIDADE CURTA. Recuperacao vale 1 hora; confirmacao vale 2 dias (nao ha
//      pressa e o e-mail pode demorar). Um link antigo esquecido numa caixa de
//      entrada nao e uma chave permanente.
//
// E mais um, que nao e do token e sim do fluxo: pedir um link novo INVALIDA o
// anterior do mesmo tipo. Senao cada pedido de "esqueci a senha" deixaria mais
// uma chave valida circulando por ai.

const crypto = require('crypto');
const { abrir } = require('./banco');

const VALIDADE = {
  verificar: 48 * 60 * 60 * 1000, // 2 dias
  recuperar: 60 * 60 * 1000, //     1 hora
};

class ErroDeToken extends Error {}

const embaralhar = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

// Cria um token novo e derruba os anteriores do mesmo tipo.
// Devolve o valor ORIGINAL - a unica vez que ele existe fora do e-mail.
function criar(usuarioId, tipo, agora = Date.now()) {
  if (!VALIDADE[tipo]) throw new Error(`tipo de token desconhecido: ${tipo}`);

  const token = crypto.randomBytes(32).toString('hex');
  const banco = abrir();

  banco.transaction(() => {
    banco
      .prepare('DELETE FROM tokens WHERE usuario_id = ? AND tipo = ?')
      .run(usuarioId, tipo);
    banco
      .prepare(
        'INSERT INTO tokens (hash, usuario_id, tipo, expira_em, criado_em) VALUES (?, ?, ?, ?, ?)'
      )
      .run(embaralhar(token), usuarioId, tipo, agora + VALIDADE[tipo], agora);
  })();

  return token;
}

// Consome o token e devolve o id do dono. Lanca quando o link nao vale mais.
// As mensagens sao diferentes de proposito: "expirou" e "ja foi usado" sao
// situacoes que a pessoa consegue resolver sozinha, e saber qual delas e ajuda.
function consumir(token, tipo, agora = Date.now()) {
  const banco = abrir();
  const linha = banco
    .prepare('SELECT * FROM tokens WHERE hash = ? AND tipo = ?')
    .get(embaralhar(token || ''), tipo);

  if (!linha) throw new ErroDeToken('Este link não é válido. Peça um novo.');
  if (linha.usado_em) throw new ErroDeToken('Este link já foi usado. Peça um novo.');
  if (linha.expira_em < agora) throw new ErroDeToken('Este link expirou. Peça um novo.');

  banco.prepare('UPDATE tokens SET usado_em = ? WHERE hash = ?').run(agora, linha.hash);
  return linha.usuario_id;
}

// Faxina: tokens vencidos nao servem para nada e nao precisam ocupar espaco.
const limparVencidos = (agora = Date.now()) =>
  abrir().prepare('DELETE FROM tokens WHERE expira_em < ?').run(agora).changes;

module.exports = { criar, consumir, limparVencidos, ErroDeToken, VALIDADE };
