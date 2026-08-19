// Contas e sessoes.
//
// UMA CONTA TEM TRES COISAS: e-mail, apelido e senha.
//   e-mail  - a identidade verificavel. E por ele, e SO por ele, que se
//             recupera o acesso
//   apelido - o nome no ranking e o login do dia a dia
//   senha   - guardada como scrypt(senha, sal); a senha em si nao existe aqui
//
// O E-MAIL PRECISA SER CONFIRMADO, mas nao para jogar - para PONTUAR. Quem
// acabou de se cadastrar entra e joga na hora; a pontuacao so entra no ranking
// depois do clique no link. A troca e proposital: um e-mail que demora nao
// custa um jogador, e ainda da um motivo concreto para confirmar.
//
// POR QUE SO PELO E-MAIL SE RECUPERA: se desse para recuperar sabendo o
// apelido, o apelido - que aparece no ranking para todo mundo - viraria o
// primeiro passo para roubar uma conta. Quem nao tem acesso a caixa de entrada
// nao tem por onde comecar.
//
// TUDO AQUI E ASSINCRONO desde que o banco saiu para a nuvem (ver banco.js):
// toda funcao que toca no banco devolve uma promessa e precisa de `await`.
//
// SESSAO: um texto de tres partes, "usuarioId.expiraEm.assinatura", assinado
// com HMAC-SHA256. O servidor nao guarda sessao nenhuma - ele so confere a
// assinatura. Sem a chave secreta ninguem forja um token, e mudar qualquer
// letra do id ou da validade invalida a assinatura.

const crypto = require('crypto');
const banco = require('./banco');

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
async function lerSessao(token, agora = Date.now()) {
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

// ------------------------------------------------------------ apelido e e-mail

const APELIDO_MAXIMO = 16;
const APELIDO_MINIMO = 3;

const chaveDoApelido = (apelido) => String(apelido || '').trim().toLowerCase();
const chaveDoEmail = (email) => String(email || '').trim().toLowerCase();

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

// A validacao de e-mail para de proposito no basico: "tem uma arroba, tem um
// ponto depois dela, nao tem espaco". Regex elaborada de e-mail e famosa por
// recusar endereco valido, e nao adianta nada - quem prova que o endereco
// existe e funciona e o link que chega nele, nao a regex.
function validarEmail(email) {
  const limpo = String(email || '').trim();
  if (!limpo) throw new ErroDeConta('Digite seu e-mail.');
  if (limpo.length > 200) throw new ErroDeConta('E-mail longo demais.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(limpo)) {
    throw new ErroDeConta('Esse e-mail não parece válido.');
  }
  return limpo;
}

// ------------------------------------------------------------------ buscas

const porId = (id) => banco.um('SELECT * FROM usuarios WHERE id = ?', [String(id || '')]);

const porApelido = (apelido) =>
  banco.um('SELECT * FROM usuarios WHERE apelido_chave = ?', [chaveDoApelido(apelido)]);

const porEmail = (email) =>
  banco.um('SELECT * FROM usuarios WHERE email_chave = ?', [chaveDoEmail(email)]);

// Entrar aceita o apelido OU o e-mail. Sao duas coisas que a pessoa sabe de cor,
// e obrigar a lembrar qual das duas e o login seria atrito a toa.
const porLogin = (texto) =>
  String(texto || '').includes('@') ? porEmail(texto) : porApelido(texto);

const marcarVisto = (id) =>
  banco.rodar('UPDATE usuarios SET visto_em = ? WHERE id = ?', [Date.now(), id]);

const verificado = (usuario) => Boolean(usuario && usuario.email_verificado_em);

// ------------------------------------------------------------------ cadastro

async function criarConta({ email, apelido, senha }) {
  const enderecoLimpo = validarEmail(email);
  const nome = validarApelido(apelido);
  validarSenha(senha);

  if (await porApelido(nome)) throw new ErroDeConta('Esse apelido já está em uso. Escolha outro.');
  if (await porEmail(enderecoLimpo)) {
    throw new ErroDeConta('Já existe uma conta com esse e-mail. Tente entrar com ele.');
  }

  const agora = Date.now();
  const id = crypto.randomUUID();
  const { hash, sal } = embaralharSenha(senha);

  await banco.rodar(
    `INSERT INTO usuarios
       (id, apelido, apelido_chave, email, email_chave, senha_hash, senha_sal, criado_em, visto_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, nome, chaveDoApelido(nome), enderecoLimpo, chaveDoEmail(enderecoLimpo), hash, sal, agora, agora]
  );

  return porId(id);
}

// ------------------------------------------------------------------ entrada

async function entrarComSenha(login, senha) {
  // Mesma mensagem para "conta nao existe", "senha errada" e "conta sem senha":
  // dizer qual dos tres errou entregaria quais apelidos e e-mails existem.
  const generico = 'Apelido, e-mail ou senha incorretos.';
  const usuario = await porLogin(login);
  if (!usuario) throw new ErroDeConta(generico);
  if (!usuario.senha_hash) throw new ErroDeConta(generico);
  if (!senhaConfere(senha, usuario.senha_hash, usuario.senha_sal)) throw new ErroDeConta(generico);
  await marcarVisto(usuario.id);
  return usuario;
}

// ------------------------------------------------------------- verificacao

// Chamado quando o link do e-mail e aberto. O token ja foi conferido em
// dados/tokens.js; aqui so carimbamos a data.
async function marcarEmailVerificado(usuarioId, agora = Date.now()) {
  const usuario = await porId(usuarioId);
  if (!usuario) throw new ErroDeConta('Conta não encontrada.');
  // Confirmar duas vezes nao e erro - o segundo clique no mesmo link e um
  // acidente comum, e ja tinha dado certo.
  if (!usuario.email_verificado_em) {
    await banco.rodar('UPDATE usuarios SET email_verificado_em = ? WHERE id = ?', [agora, usuarioId]);
  }
  return porId(usuarioId);
}

// Trocar o e-mail antes de confirmar: quem digitou errado precisa de saida.
// O novo endereco entra como NAO confirmado, obviamente.
async function trocarEmail(usuarioId, novoEmail) {
  const limpo = validarEmail(novoEmail);
  const usuario = await porId(usuarioId);
  if (!usuario) throw new ErroDeConta('Conta não encontrada.');

  const dono = await porEmail(limpo);
  if (dono && dono.id !== usuario.id) {
    throw new ErroDeConta('Já existe uma conta com esse e-mail.');
  }

  await banco.rodar(
    'UPDATE usuarios SET email = ?, email_chave = ?, email_verificado_em = NULL WHERE id = ?',
    [limpo, chaveDoEmail(limpo), usuarioId]
  );
  return porId(usuarioId);
}

// ------------------------------------------------------------- recuperacao

// Define a senha nova. O direito de fazer isso ja foi provado pelo token do
// e-mail, conferido em dados/tokens.js - por isso aqui nao ha apelido nem senha
// antiga.
//
// Confirmar o e-mail junto e de proposito: quem abriu o link provou que a caixa
// de entrada e dele, que e exatamente o que a verificacao queria descobrir.
async function definirSenhaPorToken(usuarioId, novaSenha, agora = Date.now()) {
  validarSenha(novaSenha);
  const usuario = await porId(usuarioId);
  if (!usuario) throw new ErroDeConta('Conta não encontrada.');

  const { hash, sal } = embaralharSenha(novaSenha);
  await banco.rodar(
    `UPDATE usuarios
        SET senha_hash = ?, senha_sal = ?, senha_trocada_em = ?, visto_em = ?,
            email_verificado_em = COALESCE(email_verificado_em, ?)
      WHERE id = ?`,
    [hash, sal, agora, agora, agora, usuarioId]
  );
  return porId(usuarioId);
}

// Trocar a senha estando logado: aqui a prova e a senha atual.
async function trocarSenha(usuarioId, senhaAtual, novaSenha) {
  const usuario = await porId(usuarioId);
  if (!usuario) throw new ErroDeConta('Conta não encontrada.');
  if (usuario.senha_hash && !senhaConfere(senhaAtual, usuario.senha_hash, usuario.senha_sal)) {
    throw new ErroDeConta('Senha atual incorreta.');
  }
  validarSenha(novaSenha);

  const { hash, sal } = embaralharSenha(novaSenha);
  await banco.rodar(
    'UPDATE usuarios SET senha_hash = ?, senha_sal = ?, senha_trocada_em = ? WHERE id = ?',
    [hash, sal, Date.now(), usuarioId]
  );
  return porId(usuarioId);
}

// O que pode sair do servidor.
//
// NUNCA sai: senha_hash e senha_sal. O e-mail sai apenas para o DONO da conta -
// ele nao aparece para os outros jogadores nem no ranking.
const paraOCliente = (usuario) =>
  usuario
    ? {
        id: usuario.id,
        nome: usuario.apelido,
        email: usuario.email || null,
        verificado: verificado(usuario),
      }
    : null;

module.exports = {
  ErroDeConta,
  criarConta,
  entrarComSenha,
  marcarEmailVerificado,
  trocarEmail,
  definirSenhaPorToken,
  trocarSenha,
  criarSessao,
  lerSessao,
  porId,
  porApelido,
  porEmail,
  porLogin,
  verificado,
  paraOCliente,
  DURACAO_DA_SESSAO_MS,
  SENHA_MINIMA,
  // exportados para os testes
  embaralharSenha,
  senhaConfere,
  validarApelido,
  validarEmail,
};
