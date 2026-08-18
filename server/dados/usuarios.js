// Contas e sessoes.
//
// DUAS MANEIRAS DE ENTRAR, UMA SO CONTA:
//   'google' - o Google diz quem a pessoa e; nao guardamos senha nenhuma
//   'local'  - apelido + senha, para quem nao quer (ou nao pode) usar o Google
// As duas caem na mesma tabela `usuarios` e no mesmo formato de sessao, entao o
// resto do jogo nao precisa saber por onde a pessoa entrou.
//
// SENHAS: nunca guardadas. Guardamos scrypt(senha, sal) - uma funcao lenta de
// proposito, feita para tornar caro testar milhoes de senhas. O scrypt vem do
// proprio Node (node:crypto), sem biblioteca de terceiros.
//
// SESSAO: um texto de tres partes, "usuarioId.expiraEm.assinatura", assinado
// com HMAC-SHA256. O servidor nao guarda sessao nenhuma - ele so confere a
// assinatura. Sem a chave secreta ninguem consegue forjar um token, e mudar
// qualquer letra do id ou da validade invalida a assinatura.

const crypto = require('crypto');
const { abrir } = require('./banco');

const DURACAO_DA_SESSAO_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

// Em producao venha de SESSAO_SEGREDO. Sem ela, sorteamos uma chave a cada boot:
// funciona, mas todo reinicio desloga geral - e o aviso abaixo existe para isso
// nao passar despercebido.
const SEGREDO = process.env.SESSAO_SEGREDO || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSAO_SEGREDO && process.env.NODE_ENV === 'production') {
  console.warn(
    '[contas] SESSAO_SEGREDO nao configurada: cada reinicio vai deslogar todo mundo.'
  );
}

class ErroDeConta extends Error {}

// ------------------------------------------------------------------ senhas

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

// ------------------------------------------------------------------ contas

const NOME_MAXIMO = 16;

function limparNome(nome) {
  const limpo = String(nome || '').trim().slice(0, NOME_MAXIMO);
  if (limpo.length < 2) throw new ErroDeConta('O nome precisa ter pelo menos 2 letras.');
  return limpo;
}

const porId = (id) => abrir().prepare('SELECT * FROM usuarios WHERE id = ?').get(id) || null;

const porProvedor = (provedor, provedorId) =>
  abrir()
    .prepare('SELECT * FROM usuarios WHERE provedor = ? AND provedor_id = ?')
    .get(provedor, provedorId) || null;

function inserir({ provedor, provedorId, nome, senha }) {
  const agora = Date.now();
  const id = crypto.randomUUID();
  const { hash, sal } = senha ? embaralharSenha(senha) : { hash: null, sal: null };

  abrir()
    .prepare(
      `INSERT INTO usuarios (id, provedor, provedor_id, nome, senha_hash, senha_sal, criado_em, visto_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, provedor, provedorId, nome, hash, sal, agora, agora);

  return porId(id);
}

function marcarVisto(id) {
  abrir().prepare('UPDATE usuarios SET visto_em = ? WHERE id = ?').run(Date.now(), id);
}

// ---------------------------------------------------------------- conta local

const chaveDoApelido = (nome) => String(nome || '').trim().toLowerCase();

function criarContaLocal(nome, senha) {
  const limpo = limparNome(nome);
  if (String(senha || '').length < 4) {
    throw new ErroDeConta('A senha precisa ter pelo menos 4 caracteres.');
  }
  if (porProvedor('local', chaveDoApelido(limpo))) {
    throw new ErroDeConta('Já existe uma conta com esse nome. Tente entrar.');
  }
  return inserir({ provedor: 'local', provedorId: chaveDoApelido(limpo), nome: limpo, senha });
}

function entrarComSenha(nome, senha) {
  const usuario = porProvedor('local', chaveDoApelido(nome));
  // Mesma mensagem para "conta nao existe" e "senha errada": dizer qual dos dois
  // errou entregaria a quem tenta adivinhar quais apelidos existem.
  const generico = 'Nome ou senha incorretos.';
  if (!usuario) throw new ErroDeConta(generico);
  if (!senhaConfere(senha, usuario.senha_hash, usuario.senha_sal)) throw new ErroDeConta(generico);
  marcarVisto(usuario.id);
  return usuario;
}

// ------------------------------------------------------------ conta do Google
//
// Recebe o que o Google ja confirmou (ver server/auth/google.js). Primeira vez
// cria a conta; nas seguintes so atualiza o nome, caso a pessoa tenha mudado no
// Google. O identificador e o 'sub' - o e-mail nao serve, porque pode mudar.

function entrarComGoogle({ sub, nome }) {
  if (!sub) throw new ErroDeConta('O Google não devolveu uma identificação válida.');
  const limpo = limparNome(nome || 'Jogador');

  const existente = porProvedor('google', sub);
  if (existente) {
    abrir()
      .prepare('UPDATE usuarios SET nome = ?, visto_em = ? WHERE id = ?')
      .run(limpo, Date.now(), existente.id);
    return porId(existente.id);
  }
  return inserir({ provedor: 'google', provedorId: sub, nome: limpo });
}

// O que pode sair do servidor: nunca o hash nem o sal da senha.
const paraOCliente = (usuario) =>
  usuario ? { id: usuario.id, nome: usuario.nome, provedor: usuario.provedor } : null;

module.exports = {
  ErroDeConta,
  criarContaLocal,
  entrarComSenha,
  entrarComGoogle,
  criarSessao,
  lerSessao,
  porId,
  paraOCliente,
  DURACAO_DA_SESSAO_MS,
  // exportados para os testes
  embaralharSenha,
  senhaConfere,
};
