// Login com o Google.
//
// COMO FUNCIONA, EM UMA FRASE: o navegador conversa com o Google, recebe de
// volta um cracha assinado (um "ID token") e manda esse cracha para ca; aqui
// conferimos a assinatura com as chaves publicas do proprio Google.
//
// O QUE ISSO SIGNIFICA NA PRATICA:
//   * Nao existe senha do Google passando pelo nosso servidor. Nunca.
//   * Nao existe "client secret" neste fluxo. O unico dado de configuracao e o
//     GOOGLE_CLIENT_ID, que e publico por natureza - ele vai para o navegador
//     de proposito, e e por isso que da para expor em /api/conta/config.
//   * Quem garante que o cracha e legitimo e a assinatura, nao quem o enviou.
//
// O QUE CONFERIMOS (a biblioteca oficial faz os tres):
//   assinatura RS256 com as chaves publicas do Google, validade (exp) e se o
//   cracha foi emitido PARA ESTE aplicativo (aud === GOOGLE_CLIENT_ID). Sem a
//   ultima checagem, um cracha valido de qualquer outro site serviria aqui.
//
// SE GOOGLE_CLIENT_ID NAO ESTIVER CONFIGURADO o login com Google fica desligado
// e o jogo segue com as contas locais. Nada quebra.

const { OAuth2Client } = require('google-auth-library');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

// ------------------------------------------------------------ modo de teste
//
// Os testes automatizados precisam percorrer o cadastro inteiro, e nao ha como
// gerar um cracha de verdade do Google sem um navegador e uma conta real.
// Com GOOGLE_MODO_TESTE=1 o servidor aceita crachas falsos no formato
//     teste:<identificador>:<email>
//
// DUAS TRAVAS PARA ISSO NUNCA VAZAR PARA PRODUCAO:
//   1. NODE_ENV=production desliga o modo de teste mesmo que a variavel exista.
//      Nao ha como ligar em producao - a checagem nao consulta so a variavel.
//   2. Um aviso gritado no console a cada boot, para nao passar despercebido.
// O render.yaml define NODE_ENV=production de proposito, fechando essa porta.
const EM_PRODUCAO = process.env.NODE_ENV === 'production';
const MODO_TESTE = process.env.GOOGLE_MODO_TESTE === '1' && !EM_PRODUCAO;

if (process.env.GOOGLE_MODO_TESTE === '1' && EM_PRODUCAO) {
  console.warn('[google] GOOGLE_MODO_TESTE ignorado: o servidor está em produção.');
}
if (MODO_TESTE) {
  console.warn('[google] ATENÇÃO: modo de teste ligado. Crachás falsos são aceitos.');
}

// Ligado quando da para usar o Google de verdade OU quando estamos testando.
const ligado = () => Boolean(CLIENT_ID) || MODO_TESTE;

let cliente = null;
const obterCliente = () => (cliente = cliente || new OAuth2Client(CLIENT_ID));

// Devolve { sub, nome, email } ou lanca. 'sub' e o identificador permanente da
// conta Google - o e-mail nao serve como chave, porque pode mudar.
async function verificarToken(idToken) {
  if (!ligado()) throw new Error('O login com Google não está configurado neste servidor.');
  if (!idToken) throw new Error('Token do Google ausente.');

  // So existe quando MODO_TESTE esta ligado - e ele nao liga em producao.
  if (MODO_TESTE && String(idToken).startsWith('teste:')) {
    const [, sub, email] = String(idToken).split(':');
    if (!sub) throw new Error('Token de teste malformado.');
    return { sub: `teste-${sub}`, nome: sub, email: email || `${sub}@exemplo.test` };
  }

  if (!CLIENT_ID) throw new Error('O login com Google não está configurado neste servidor.');

  const bilhete = await obterCliente().verifyIdToken({ idToken, audience: CLIENT_ID });
  const dados = bilhete.getPayload();
  if (!dados || !dados.sub) throw new Error('Token do Google inválido.');

  return {
    sub: dados.sub,
    nome: dados.name || dados.given_name || (dados.email || '').split('@')[0] || 'Jogador',
    email: dados.email || null,
  };
}

module.exports = { ligado, verificarToken, CLIENT_ID, MODO_TESTE };
