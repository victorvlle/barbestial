// Contas e sessoes.
//
// UMA CONTA TEM SEMPRE TRES COISAS, e nenhuma delas e opcional:
//   apelido  - o login do dia a dia, e o nome que aparece no ranking
//   senha    - guardada como scrypt(senha, sal); a senha em si nao existe aqui
//   Google   - a conta do Google conectada, identificada pelo 'sub'
//
// POR QUE OS TRES JUNTOS: o Google e a unica prova aceita para recuperar a
// senha. Quem sabe o apelido de alguem nao consegue nada - precisa conseguir
// entrar na conta do Google daquela pessoa. Se o Google fosse opcional,
// "esqueci a senha" viraria uma porta destrancada para quem conhecesse o
// apelido, que e justamente o dado mais publico que existe no jogo.
//
// PARA ENTRAR NO DIA A DIA, qualquer um dos dois caminhos serve: apelido+senha
// ou o botao do Google. Exigir os dois toda vez so atrapalharia quem so quer
// jogar - a trava que importa esta na recuperacao, nao no login.
//
// SENHAS: nunca guardadas. Guardamos scrypt(senha, sal) - uma funcao lenta de
// proposito, feita para tornar caro testar milhoes de senhas. Vem do proprio
// Node (node:crypto), sem biblioteca de terceiros.
//
// SESSAO: um texto de tres partes, "usuarioId.expiraEm.assinatura", assinado
// com HMAC-SHA256. O servidor nao guarda sessao nenhuma - ele so confere a
// assinatura. Sem a chave secreta ninguem forja um token, e mudar qualquer
// letra do id ou da validade invalida a assinatura.

const crypto = require('crypto');
const { abrir } = require('./banco');

const DURACAO_DA_SESSAO_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

const SEGREDO = process.env.SESSAO_SEGREDO || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSAO_SEGREDO && process.env.NODE_ENV === 'production') {
  console.warn('[contas] SESSAO_SEGREDO nao configurada: cada reinicio vai deslogar todo mundo.');
}

class ErroDeConta extends Error {}

// ------------------------------------------------------------------ senhas

const SENHA_MINIMA = 6;

function embaralharSenha(senha, sal = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(senha), sal, 64).toString('hex');
  return { hash, sal };
}

// Comparacao em tempo constante: comparar com === vazaria, pelo tempo de
// resposta, quantos caracteres iniciais estavam certos.
function senhaConfere(senha, hashGuardado, sal) {
  if (!hashGuardado || !sal) return false;
  const { hash } = embaralharSenha(senha, sal);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(hashGuardado, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validarSenha(senha) {
  if (String(senha || '').length < SENHA_MINIMA) {
    throw new ErroDeConta(`A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`);
  }
  return String(senha);
}

// ------------------------------------------------------------------ sessao

const assinar = (corpo) => crypto.createHmac('sha256', SEGREDO).update(corpo).digest('hex');

function criarSessao(usuarioId, agora = Date.now()) {
  const corpo = `${usuarioId}.${agora + DURACAO_DA_SESSAO_MS}`;
  return `${corpo}.${assinar(corpo)}`;
}

// Devolve o usuario ou null. Nunca lanca: um token estragado e apenas "nao logado".
function lerSessao(token, agora = Date.now()) {
  if (typeof token !== 'string') return null;
  const partes = token.split('.');
  if (partes.length !== 3) return null;

  const [usuarioId, expiraEm, assinatura] = partes;
  const esperada = assinar(`${usuarioId}.${expiraEm}`);
  const a = Buffer.from(assinatura, 'utf8');
  const b = Buffer.from(esperada, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (!Number(expiraEm) || Number(expiraEm) < agora) return null;

  return porId(usuarioId);
}

// ------------------------------------------------------------------ apelido

const APELIDO_MAXIMO = 16;
const APELIDO_MINIMO = 3;

const chaveDoApelido = (apelido) => String(apelido || '').trim().toLowerCase();

function validarApelido(apelido) {
  const limpo = String(apelido || '').trim().slice(0, APELIDO_MAXIMO);
  if (limpo.length < APELIDO_MINIMO) {
    throw new ErroDeConta(`O apelido precisa ter pelo menos ${APELIDO_MINIMO} letras.`);
  }
  // Sem espacos nem simbolos: o apelido e um login, e vai aparecer no ranking.
  if (!/^[\p{L}\p{N}_.-]+$/u.test(limpo)) {
    throw new ErroDeConta('Use apenas letras, números, ponto, hífen ou _ no apelido.');
  }
  return limpo;
}

// ------------------------------------------------------------------ buscas

const porId = (id) => abrir().prepare('SELECT * FROM usuarios WHERE id = ?').get(id) || null;

const porApelido = (apelido) =>
  abrir().prepare('SELECT * FROM usuarios WHERE apelido_chave = ?').get(chaveDoApelido(apelido)) ||
  null;

const porGoogle = (sub) =>
  abrir().prepare('SELECT * FROM usuarios WHERE google_sub = ?').get(String(sub || '')) || null;

const marcarVisto = (id) =>
  abrir().prepare('UPDATE usuarios SET visto_em = ? WHERE id = ?').run(Date.now(), id);

// ------------------------------------------------------------------ cadastro
//
// Recebe o `google` JA CONFERIDO por server/auth/google.js - este arquivo nunca
// acredita num token cru vindo do navegador.

function criarConta({ apelido, senha, google }) {
  const nome = validarApelido(apelido);
  validarSenha(senha);

  if (!google || !google.sub) {
    throw new ErroDeConta('Conecte sua conta do Google para concluir o cadastro.');
  }
  if (porApelido(nome)) {
    throw new ErroDeConta('Esse apelido já está em uso. Escolha outro.');
  }
  // Uma conta do Google por jogador: senao a mesma pessoa criaria apelidos
  // infinitos e o ranking viraria piada.
  if (porGoogle(google.sub)) {
    throw new ErroDeConta('Essa conta do Google já está ligada a outro apelido.');
  }

  const agora = Date.now();
  const id = crypto.randomUUID();
  const { hash, sal } = embaralharSenha(senha);

  abrir()
    .prepare(
      `INSERT INTO usuarios
         (id, apelido, apelido_chave, senha_hash, senha_sal, google_sub, google_email, criado_em, visto_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, nome, chaveDoApelido(nome), hash, sal, google.sub, google.email || null, agora, agora);

  return porId(id);
}

// ------------------------------------------------------------------ entrada

function entrarComSenha(apelido, senha) {
  // Mesma mensagem para "conta nao existe" e "senha errada": dizer qual dos
  // dois errou entregaria quais apelidos existem.
  const generico = 'Apelido ou senha incorretos.';
  const usuario = porApelido(apelido);
  if (!usuario) throw new ErroDeConta(generico);
  if (!senhaConfere(senha, usuario.senha_hash, usuario.senha_sal)) throw new ErroDeConta(generico);
  marcarVisto(usuario.id);
  return usuario;
}

// Entrar pelo botao do Google. NAO cria conta: como a senha e o apelido tambem
// sao obrigatorios, cadastrar exige passar pelo formulario.
function entrarComGoogle(google) {
  if (!google || !google.sub) throw new ErroDeConta('O Google não confirmou sua identidade.');
  const usuario = porGoogle(google.sub);
  if (!usuario) {
    throw new ErroDeConta('Nenhuma conta ligada a este Google. Crie sua conta primeiro.');
  }
  // O e-mail pode mudar no Google; o 'sub' nunca muda. Mantemos o e-mail atual
  // so para aparecer no painel de administracao.
  abrir()
    .prepare('UPDATE usuarios SET google_email = ?, visto_em = ? WHERE id = ?')
    .run(google.email || usuario.google_email, Date.now(), usuario.id);
  return porId(usuario.id);
}

// ------------------------------------------------------------- recuperacao
//
// A UNICA porta de recuperacao, e ela nao aceita apelido.
//
// Repare no que esta funcao NAO recebe: apelido. Quem chega aqui precisa ter
// acabado de entrar numa conta do Google, e a conta a ser recuperada e
// encontrada POR AQUELE Google - nao por um nome digitado. Nao existe caminho
// em que saber o apelido de alguem ajude a trocar a senha dessa pessoa.
//
// A mensagem de erro tambem nao conta se aquele Google tem conta ou nao: isso
// diria a um curioso se fulano joga aqui.
function trocarSenhaComGoogle(google, novaSenha) {
  if (!google || !google.sub) throw new ErroDeConta('O Google não confirmou sua identidade.');
  validarSenha(novaSenha);

  const usuario = porGoogle(google.sub);
  if (!usuario) {
    throw new ErroDeConta('Nenhuma conta ligada a este Google. Crie sua conta primeiro.');
  }

  const { hash, sal } = embaralharSenha(novaSenha);
  abrir()
    .prepare(
      'UPDATE usuarios SET senha_hash = ?, senha_sal = ?, senha_trocada_em = ?, visto_em = ? WHERE id = ?'
    )
    .run(hash, sal, Date.now(), Date.now(), usuario.id);

  return porId(usuario.id);
}

// Trocar a senha estando logado: aqui a senha atual e a prova.
function trocarSenha(usuarioId, senhaAtual, novaSenha) {
  const usuario = porId(usuarioId);
  if (!usuario) throw new ErroDeConta('Conta não encontrada.');
  if (!senhaConfere(senhaAtual, usuario.senha_hash, usuario.senha_sal)) {
    throw new ErroDeConta('Senha atual incorreta.');
  }
  validarSenha(novaSenha);

  const { hash, sal } = embaralharSenha(novaSenha);
  abrir()
    .prepare('UPDATE usuarios SET senha_hash = ?, senha_sal = ?, senha_trocada_em = ? WHERE id = ?')
    .run(hash, sal, Date.now(), usuario.id);
  return porId(usuario.id);
}

// O que pode sair do servidor: nunca o hash, nunca o sal, nunca o 'sub' do
// Google (ele identifica a pessoa em qualquer site que use login do Google).
const paraOCliente = (usuario) =>
  usuario ? { id: usuario.id, nome: usuario.apelido, temGoogle: Boolean(usuario.google_sub) } : null;

module.exports = {
  ErroDeConta,
  criarConta,
  entrarComSenha,
  entrarComGoogle,
  trocarSenhaComGoogle,
  trocarSenha,
  criarSessao,
  lerSessao,
  porId,
  porApelido,
  porGoogle,
  paraOCliente,
  DURACAO_DA_SESSAO_MS,
  SENHA_MINIMA,
  // exportados para os testes
  embaralharSenha,
  senhaConfere,
  validarApelido,
};
