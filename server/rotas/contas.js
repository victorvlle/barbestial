// As rotas HTTP de conta e ranking.
//
// Por que HTTP e nao Socket.IO: entrar na conta acontece ANTES de existir jogo.
// Misturar isso no canal de tempo real complicaria os dois lados. Aqui e um
// pedido, uma resposta, e acabou - e o socket so entra depois, ja com o cracha.
//
// Formato das respostas: sempre { ok: true, ... } ou { ok: false, erro: '...' },
// o mesmo contrato que o resto do jogo ja usa nos acknowledgements do socket.
//
// AS PORTAS DE CONTA:
//   POST /conta/criar   e-mail + apelido + senha; ja entra jogando
//   POST /conta/entrar  apelido OU e-mail + senha
//   POST /conta/senha   estando logado, troca a senha
//   GET  /conta/eu      "ainda estou logado?"
//
// NAO EXISTE RECUPERACAO AUTOMATICA, e isso e uma decisao, nao um esquecimento.
// Recuperar senha sozinho exige mandar e-mail, e o servidor gratuito onde o
// jogo roda bloqueia as portas de SMTP. Em vez de um botao que promete um
// e-mail que nunca chega, quem esquecer a senha fala com o administrador, que
// define uma nova pelo painel /admin. O e-mail continua sendo pedido no
// cadastro: e como o administrador sabe com quem esta falando.
//
// SOBRE CSRF: nao se aplica a esta arquitetura. O cracha de sessao viaja no
// cabecalho Authorization, nunca em cookie - e um site de terceiros nao
// consegue ler o localStorage deste dominio para montar esse cabecalho. Um
// POST forjado de outro site chega aqui sem cracha e e recusado como qualquer
// pedido anonimo.
//
// SOBRE CORS: o front e servido pelo MESMO servidor que responde estas rotas,
// entao nao ha requisicao entre origens e nenhum cabecalho de CORS e
// necessario. Nao habilitamos CORS de proposito: abrir a API para outras
// origens sem precisar so aumentaria a superficie de ataque.

const express = require('express');
const usuarios = require('../dados/usuarios');
const ranking = require('../dados/ranking');

const router = express.Router();

// ------------------------------------------------------ freio de tentativas
//
// Senha se descobre tentando. Este contador simples (na memoria do processo)
// segura quem tenta muitas vezes seguidas do mesmo lugar.
//
// SO TENTATIVA ERRADA CONTA. Um cadastro que deu certo, ou um login que
// funcionou, nao gastam cota - senao uma familia atras do mesmo roteador
// ficaria trancada do lado de fora numa noite de jogo.

const FALHAS_MAXIMAS = 10;
const JANELA_MS = 60 * 1000;
const falhas = new Map();

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

const comFreio = (acao) => async (req, res) => {
  if (bloqueado(req.ip)) throw new usuarios.ErroDeConta('Muitas tentativas. Espere um minuto.');
  try {
    const saida = await acao(req, res);
    falhas.delete(req.ip);
    return saida;
  } catch (erro) {
    contarFalha(req.ip);
    throw erro;
  }
};

// Envolve um handler para que ErroDeConta e ErroDeToken virem respostas
// amigaveis, e um erro inesperado nao derrube o servidor nem vaze detalhes.
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

// Assincrona porque ler a sessao termina numa consulta ao banco (ver banco.js).
function usuarioDoPedido(req) {
  const cabecalho = String(req.headers.authorization || '');
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : '';
  return usuarios.lerSessao(token);
}

// ------------------------------------------------------------------ rotas

router.get('/conta/config', (_req, res) => {
  res.json({ ok: true, senhaMinima: usuarios.SENHA_MINIMA });
});

// Cadastro. A conta ja nasce logada: a pessoa preenche, entra e joga - sem
// nenhuma etapa no meio.
router.post(
  '/conta/criar',
  responder(comFreio(async (req) => {
    const { email, nome, senha } = req.body || {};
    return comSessao(await usuarios.criarConta({ email, apelido: nome, senha }));
  }))
);

router.post(
  '/conta/entrar',
  responder(comFreio(async (req) => {
    const { nome, senha } = req.body || {};
    return comSessao(await usuarios.entrarComSenha(nome, senha));
  }))
);

// Trocar a senha ja estando logado: aqui a prova e a senha atual.
router.post(
  '/conta/senha',
  responder(comFreio(async (req) => {
    const eu = await usuarioDoPedido(req);
    if (!eu) throw new usuarios.ErroDeConta('Sessão expirada. Entre de novo.');
    const { senhaAtual, novaSenha } = req.body || {};
    await usuarios.trocarSenha(eu.id, senhaAtual, novaSenha);
    return {};
  }))
);

// "Ainda estou logado?" - e o que o navegador pergunta ao abrir a pagina.
router.get('/conta/eu', async (req, res) => {
  const usuario = await usuarioDoPedido(req);
  if (!usuario) return res.status(401).json({ ok: false, erro: 'Sessão expirada.' });
  res.json({ ok: true, usuario: usuarios.paraOCliente(usuario) });
});

// Ranking. Publico de proposito: ver a classificacao nao exige estar logado, e
// assim a tela de login ja pode mostrar quem esta ganhando a semana.
router.get('/ranking', async (req, res) => {
  try {
    const semana = req.query.semana ? String(req.query.semana) : null;
    const atual = ranking.semanaAtual();
    res.json({
      ok: true,
      semana: semana ? { chave: semana } : atual,
      ranking: await ranking.rankingDaSemana(semana || atual.chave),
    });
  } catch (erro) {
    console.error('[ranking]', erro);
    res.status(500).json({ ok: false, erro: 'Não foi possível ler o ranking.' });
  }
});

router.get('/ranking/semanas', async (_req, res) => {
  try {
    res.json({ ok: true, semanas: await ranking.semanasComPartidas() });
  } catch (erro) {
    console.error('[ranking]', erro);
    res.status(500).json({ ok: false, erro: 'Não foi possível ler o histórico.' });
  }
});

module.exports = { router, usuarioDoPedido };
