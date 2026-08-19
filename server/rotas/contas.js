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
//   POST /conta/criar       e-mail + apelido + senha
//   POST /conta/entrar      apelido OU e-mail + senha
//   GET  /conta/verificar   o link que chega por e-mail (abre no navegador)
//   POST /conta/reenviar    estando logado, manda o link de confirmacao de novo
//   POST /conta/trocar-email estando logado, corrige o e-mail digitado errado
//   POST /conta/esqueci     manda o link de recuperacao
//   POST /conta/redefinir   token do e-mail + senha nova
//   POST /conta/senha       estando logado, troca a senha
//
// Repare que /conta/esqueci recebe E-MAIL, nunca apelido. O apelido aparece no
// ranking para todo mundo; usa-lo como chave de recuperacao transformaria a
// lista de campeoes numa lista de alvos.
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
const tokens = require('../dados/tokens');
const correio = require('../email/enviar');
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

// ---------------------------------------------- freio proprio para o e-mail
//
// Mandar e-mail custa dinheiro e reputacao de dominio. Sem um limite, alguem
// poderia usar o "esqueci a senha" para bombardear a caixa de entrada de outra
// pessoa. Um pedido por minuto por endereco resolve.

const ENTRE_EMAILS_MS = 60 * 1000;
const ultimoEmail = new Map();

function podeMandarEmail(chave) {
  const agora = Date.now();
  if ((ultimoEmail.get(chave) || 0) + ENTRE_EMAILS_MS > agora) return false;
  ultimoEmail.set(chave, agora);
  return true;
}

// Envolve um handler para que ErroDeConta e ErroDeToken virem respostas
// amigaveis, e um erro inesperado nao derrube o servidor nem vaze detalhes.
const responder = (acao) => async (req, res) => {
  try {
    res.json({ ok: true, ...((await acao(req, res)) || {}) });
  } catch (erro) {
    const esperado = erro instanceof usuarios.ErroDeConta || erro instanceof tokens.ErroDeToken;
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

function usuarioDoPedido(req) {
  const cabecalho = String(req.headers.authorization || '');
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : '';
  return usuarios.lerSessao(token);
}

// Cria o link e manda. Nunca lanca: falhar em enviar e-mail nao pode custar um
// cadastro (a pessoa usa o botao de reenviar).
async function mandarVerificacao(usuario) {
  if (!usuario.email) return;
  const token = tokens.criar(usuario.id, 'verificar');
  await correio.enviarVerificacao(usuario, token);
}

// ------------------------------------------------------------------ rotas

router.get('/conta/config', (_req, res) => {
  res.json({
    ok: true,
    email: correio.ligado(), // false = os links saem no log do servidor
    senhaMinima: usuarios.SENHA_MINIMA,
  });
});

// Cadastro. A conta ja nasce logada: a pessoa entra e joga na hora, e o e-mail
// de confirmacao chega enquanto ela joga.
router.post(
  '/conta/criar',
  responder(comFreio(async (req) => {
    const { email, nome, senha } = req.body || {};
    const usuario = usuarios.criarConta({ email, apelido: nome, senha });
    podeMandarEmail(usuario.email_chave);
    await mandarVerificacao(usuario);
    return comSessao(usuario);
  }))
);

router.post(
  '/conta/entrar',
  responder(comFreio(async (req) => {
    const { nome, senha } = req.body || {};
    return comSessao(usuarios.entrarComSenha(nome, senha));
  }))
);

// O LINK DO E-MAIL. Abre direto no navegador, entao responde com um redirecionamento
// em vez de JSON - quem clica e uma pessoa, nao um programa.
router.get('/conta/verificar', (req, res) => {
  try {
    const usuarioId = tokens.consumir(req.query.t, 'verificar');
    usuarios.marcarEmailVerificado(usuarioId);
    res.redirect('/?verificado=1');
  } catch (erro) {
    console.warn('[conta] verificação recusada:', erro.message);
    res.redirect('/?verificado=0');
  }
});

// Reenviar a confirmacao, estando logado.
router.post(
  '/conta/reenviar',
  responder(async (req) => {
    const eu = usuarioDoPedido(req);
    if (!eu) throw new usuarios.ErroDeConta('Sessão expirada. Entre de novo.');
    if (usuarios.verificado(eu)) return { jaVerificado: true };
    if (!podeMandarEmail(eu.email_chave)) {
      throw new usuarios.ErroDeConta('Já enviamos um e-mail agora há pouco. Espere um minuto.');
    }
    await mandarVerificacao(eu);
    return { enviado: true };
  })
);

// Corrigir o e-mail digitado errado (so antes de confirmar).
router.post(
  '/conta/trocar-email',
  responder(comFreio(async (req) => {
    const eu = usuarioDoPedido(req);
    if (!eu) throw new usuarios.ErroDeConta('Sessão expirada. Entre de novo.');
    if (usuarios.verificado(eu)) {
      throw new usuarios.ErroDeConta('Seu e-mail já foi confirmado.');
    }
    const atualizado = usuarios.trocarEmail(eu.id, (req.body || {}).email);
    podeMandarEmail(atualizado.email_chave);
    await mandarVerificacao(atualizado);
    return { usuario: usuarios.paraOCliente(atualizado) };
  }))
);

// "Esqueci minha senha".
//
// RESPONDE SEMPRE A MESMA COISA, exista a conta ou nao. Se a resposta mudasse,
// esta rota viraria um consultor gratuito de "este e-mail tem conta aqui?" -
// util para quem monta lista de alvos, e um vazamento de privacidade dos
// jogadores.
router.post(
  '/conta/esqueci',
  responder(async (req) => {
    const email = String((req.body || {}).email || '').trim();
    const usuario = email ? usuarios.porEmail(email) : null;

    if (usuario && usuario.email && podeMandarEmail(`rec:${usuario.email_chave}`)) {
      const token = tokens.criar(usuario.id, 'recuperar');
      await correio.enviarRecuperacao(usuario, token);
    }
    return { mensagem: 'Se existir uma conta com esse e-mail, o link de recuperação está a caminho.' };
  })
);

// Define a senha nova a partir do link. Ja devolve a sessao: a pessoa acabou de
// provar que e dona da caixa de entrada, nao faz sentido pedir login em seguida.
router.post(
  '/conta/redefinir',
  responder(comFreio(async (req) => {
    const { token, novaSenha } = req.body || {};
    const usuarioId = tokens.consumir(token, 'recuperar');
    return comSessao(usuarios.definirSenhaPorToken(usuarioId, novaSenha));
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

router.get('/ranking/semanas', (_req, res) => {
  res.json({ ok: true, semanas: ranking.semanasComPartidas() });
});

module.exports = { router, usuarioDoPedido };
