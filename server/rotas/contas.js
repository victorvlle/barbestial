// As rotas HTTP de conta e ranking.
//
// Por que HTTP e nao Socket.IO: entrar na conta acontece ANTES de existir jogo.
// Misturar isso no canal de tempo real complicaria os dois lados. Aqui e um
// pedido, uma resposta, e acabou - e o socket so entra depois, ja com o cracha.
//
// Formato das respostas: sempre { ok: true, ... } ou { ok: false, erro: '...' },
// o mesmo contrato que o resto do jogo ja usa nos acknowledgements do socket.
//
// AS QUATRO PORTAS DE CONTA, e o que cada uma exige:
//   POST /conta/criar      apelido + senha + cracha do Google   (os tres)
//   POST /conta/entrar     apelido + senha
//   POST /conta/google     cracha do Google
//   POST /conta/recuperar  cracha do Google + senha nova
//
// Repare que /conta/recuperar NAO recebe apelido. E de proposito: a conta a
// recuperar e encontrada pelo Google, nunca por um nome digitado.

const express = require('express');
const usuarios = require('../dados/usuarios');
const google = require('../auth/google');
const ranking = require('../dados/ranking');

const router = express.Router();

// ------------------------------------------------------ freio de tentativas
//
// Senha se descobre tentando. Este contador simples (na memoria do processo)
// segura quem tenta muitas vezes seguidas do mesmo lugar. Nao substitui um
// firewall, mas transforma "milhoes de tentativas por minuto" em "algumas".

const FALHAS_MAXIMAS = 10;
const JANELA_MS = 60 * 1000;
const falhas = new Map(); // ip -> { contagem, ate }

// SO TENTATIVA ERRADA CONTA. Um cadastro que deu certo, ou um login que
// funcionou, nao gastam cota nenhuma - senao uma familia atras do mesmo
// roteador ficaria trancada do lado de fora numa noite de jogo. O freio existe
// para quem chuta senha, e chutar senha significa errar.
function bloqueado(ip) {
  const registro = falhas.get(ip);
  return Boolean(registro && registro.ate > Date.now() && registro.contagem >= FALHAS_MAXIMAS);
}

function contarFalha(ip) {
  const agora = Date.now();
  const registro = falhas.get(ip);
  if (!registro || registro.ate < agora) return falhas.set(ip, { contagem: 1, ate: agora + JANELA_MS });
  registro.contagem += 1;
}

// Envolve uma acao sensivel com o freio.
const comFreio = (acao) => async (req, res) => {
  if (bloqueado(req.ip)) throw new usuarios.ErroDeConta('Muitas tentativas. Espere um minuto.');
  try {
    const saida = await acao(req, res);
    falhas.delete(req.ip); // acertou: a contagem de erros recomeca
    return saida;
  } catch (erro) {
    contarFalha(req.ip);
    throw erro;
  }
};

// Envolve um handler para que ErroDeConta vire uma resposta amigavel e um erro
// inesperado nao derrube o servidor nem vaze detalhes internos para o cliente.
const responder = (acao) => async (req, res) => {
  try {
    res.json({ ok: true, ...((await acao(req, res)) || {}) });
  } catch (erro) {
    const esperado = erro instanceof usuarios.ErroDeConta;
    if (!esperado) console.error('[conta]', erro);
    res.status(esperado ? 400 : 500).json({
      ok: false,
      erro: esperado ? erro.message : 'Não foi possível concluir. Tente de novo.',
    });
  }
};

const comSessao = (usuario) => ({
  token: usuarios.criarSessao(usuario.id),
  usuario: usuarios.paraOCliente(usuario),
});

// Confere o cracha do Google e devolve os dados ja confirmados por ele.
// O motivo tecnico de uma recusa fica no log; para quem tentou, uma frase util.
async function confirmarGoogle(idToken) {
  try {
    return await google.verificarToken(idToken);
  } catch (erro) {
    console.warn('[conta] token do Google recusado:', erro.message);
    throw new usuarios.ErroDeConta('Não foi possível confirmar sua conta do Google.');
  }
}

// Le o cracha de sessao do cabecalho "Authorization: Bearer <token>".
function usuarioDoPedido(req) {
  const cabecalho = String(req.headers.authorization || '');
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : '';
  return usuarios.lerSessao(token);
}

// ------------------------------------------------------------------ rotas

// O que o navegador precisa saber antes de desenhar a tela de login. O
// GOOGLE_CLIENT_ID e publico por natureza (o Google exige que ele apareca na
// pagina); nenhum segredo sai daqui.
router.get('/conta/config', (_req, res) => {
  res.json({
    ok: true,
    google: google.ligado(),
    googleClientId: google.CLIENT_ID || null,
    modoTeste: google.MODO_TESTE,
    senhaMinima: usuarios.SENHA_MINIMA,
  });
});

// Cadastro: os tres de uma vez.
router.post(
  '/conta/criar',
  responder(comFreio(async (req) => {
    const { nome, senha, idToken } = req.body || {};
    if (!idToken) {
      throw new usuarios.ErroDeConta('Conecte sua conta do Google para concluir o cadastro.');
    }
    const confirmado = await confirmarGoogle(idToken);
    return comSessao(usuarios.criarConta({ apelido: nome, senha, google: confirmado }));
  }))
);

router.post(
  '/conta/entrar',
  responder(comFreio(async (req) => {
    const { nome, senha } = req.body || {};
    return comSessao(usuarios.entrarComSenha(nome, senha));
  }))
);

router.post(
  '/conta/google',
  responder(comFreio(async (req) => {
    const confirmado = await confirmarGoogle((req.body || {}).idToken);
    return comSessao(usuarios.entrarComGoogle(confirmado));
  }))
);

// Recuperacao de senha. A conta e achada PELO GOOGLE - nao ha campo de apelido
// nesta rota, e nao ha como pedir a troca sem entrar numa conta do Google.
router.post(
  '/conta/recuperar',
  responder(comFreio(async (req) => {
    const { idToken, novaSenha } = req.body || {};
    const confirmado = await confirmarGoogle(idToken);
    return comSessao(usuarios.trocarSenhaComGoogle(confirmado, novaSenha));
  }))
);

// Trocar a senha ja estando logado: aqui a prova e a senha atual.
router.post(
  '/conta/senha',
  responder(comFreio(async (req) => {
    const eu = usuarioDoPedido(req);
    if (!eu) throw new usuarios.ErroDeConta('Sessão expirada. Entre de novo.');
    const { senhaAtual, novaSenha } = req.body || {};
    usuarios.trocarSenha(eu.id, senhaAtual, novaSenha);
    return {};
  }))
);

// "Ainda estou logado?" - e o que o navegador pergunta ao abrir a pagina.
router.get('/conta/eu', (req, res) => {
  const usuario = usuarioDoPedido(req);
  if (!usuario) return res.status(401).json({ ok: false, erro: 'Sessão expirada.' });
  res.json({ ok: true, usuario: usuarios.paraOCliente(usuario) });
});

// Ranking. Publico de proposito: ver a classificacao nao exige estar logado, e
// assim a tela de login ja pode mostrar quem esta ganhando a semana.
router.get('/ranking', (req, res) => {
  const semana = req.query.semana ? String(req.query.semana) : null;
  const atual = ranking.semanaAtual();
  res.json({
    ok: true,
    semana: semana ? { chave: semana } : atual,
    ranking: ranking.rankingDaSemana(semana || atual.chave),
  });
});

// O historico ja existe no banco desde o primeiro dia; esta rota so o expoe.
router.get('/ranking/semanas', (_req, res) => {
  res.json({ ok: true, semanas: ranking.semanasComPartidas() });
});

module.exports = { router, usuarioDoPedido };
