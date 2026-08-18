// As rotas HTTP de conta e ranking.
//
// Por que HTTP e nao Socket.IO: entrar na conta acontece ANTES de existir
// jogo. Misturar isso no canal de tempo real complicaria os dois lados. Aqui e
// um pedido, uma resposta, e acabou - e o socket so entra depois, ja com o
// cracha na mao.
//
// Formato das respostas: sempre { ok: true, ... } ou { ok: false, erro: '...' },
// o mesmo contrato que o resto do jogo ja usa nos acknowledgements do socket.

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

const TENTATIVAS_MAXIMAS = 12;
const JANELA_MS = 60 * 1000;
const tentativas = new Map(); // ip -> { contagem, ate }

function excedeuTentativas(ip) {
  const agora = Date.now();
  const registro = tentativas.get(ip);
  if (!registro || registro.ate < agora) {
    tentativas.set(ip, { contagem: 1, ate: agora + JANELA_MS });
    return false;
  }
  registro.contagem += 1;
  return registro.contagem > TENTATIVAS_MAXIMAS;
}

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

// Le o cracha do cabecalho "Authorization: Bearer <token>".
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
  res.json({ ok: true, google: google.ligado(), googleClientId: google.CLIENT_ID || null });
});

router.post(
  '/conta/criar',
  responder(async (req) => {
    if (excedeuTentativas(req.ip)) {
      throw new usuarios.ErroDeConta('Muitas tentativas. Espere um minuto.');
    }
    const { nome, senha } = req.body || {};
    return comSessao(usuarios.criarContaLocal(nome, senha));
  })
);

router.post(
  '/conta/entrar',
  responder(async (req) => {
    if (excedeuTentativas(req.ip)) {
      throw new usuarios.ErroDeConta('Muitas tentativas. Espere um minuto.');
    }
    const { nome, senha } = req.body || {};
    return comSessao(usuarios.entrarComSenha(nome, senha));
  })
);

router.post(
  '/conta/google',
  responder(async (req) => {
    const { idToken } = req.body || {};
    let confirmado;
    try {
      confirmado = await google.verificarToken(idToken);
    } catch (erro) {
      // O motivo tecnico fica no log; para quem tentou entrar, uma frase util.
      console.warn('[conta] token do Google recusado:', erro.message);
      throw new usuarios.ErroDeConta('Não foi possível confirmar sua conta do Google.');
    }
    return comSessao(usuarios.entrarComGoogle(confirmado));
  })
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
