// A tela de login e o que acontece depois dela.
//
// DOIS MODOS, uma tela só:
//   entrar - apelido OU e-mail + senha
//   criar  - e-mail + apelido + senha, e já entra jogando
//
// NÃO EXISTE "esqueci minha senha" aqui, e isso é uma decisão: recuperar senha
// sozinho exige mandar e-mail, e o servidor onde o jogo roda bloqueia isso. Em
// vez de um botão que promete um e-mail que nunca chega, quem esquece a senha
// fala com o administrador, que define uma nova pelo painel /admin. O e-mail
// continua sendo pedido no cadastro: é como o administrador sabe de quem é cada
// conta.
//
// Nada aqui decide quem a pessoa é: isso é sempre o servidor. Este arquivo só
// pede, guarda o crachá e desenha o resultado.

let configDeLogin = { senhaMinima: 6 };
let modoAtual = 'entrar';

// ------------------------------------------------------------------ modos

function irPara(modo) {
  modoAtual = modo;
  avisar('aviso-login', '');

  for (const bloco of document.querySelectorAll('.modo')) bloco.classList.add('escondida');
  $(`modo-${modo}`).classList.remove('escondida');

  for (const aba of document.querySelectorAll('.aba')) {
    aba.classList.toggle('aba--ativa', aba.dataset.modo === modo);
  }
}

// ------------------------------------------------------------------ entrada

// Ponto único de "consegui entrar": guarda o crachá, liga o socket e troca de
// tela. Os dois caminhos (entrar e criar conta) terminam aqui.
function aoEntrar({ token, usuario }) {
  sessao.salvar(token);
  CONTA = usuario;
  JOGADOR_ID = usuario.id;

  $('quem-sou').textContent = usuario.nome;
  $('quem-sou').title = usuario.email || '';
  $('tela-login').classList.add('escondida');

  if (!socket.connected) socket.connect();
  mostrarTela('entrada');
  carregarRanking();
}

function sair() {
  sessao.apagar();
  CONTA = null;
  JOGADOR_ID = null;
  salaAtual = null;
  estadoAtual = null;
  if (socket.connected) socket.disconnect();
  $('tela-login').classList.remove('escondida');
  for (const tela of document.querySelectorAll('.tela')) tela.classList.add('escondida');
  irPara('entrar');
  avisar('aviso-login', 'Você saiu da sua conta.');
}

// --------------------------------------------------------------- formulários

async function entrarComSenha() {
  const nome = $('login-nome').value.trim();
  const senha = $('login-senha').value;
  if (!nome || !senha) return avisar('aviso-login', 'Preencha os dois campos.');

  const r = await pedir('/api/conta/entrar', { metodo: 'POST', corpo: { nome, senha } });
  if (!r.ok) return avisar('aviso-login', r.erro);
  aoEntrar(r);
}

async function criarConta() {
  const email = $('novo-email').value.trim();
  const nome = $('novo-nome').value.trim();
  const senha = $('nova-senha').value;

  const r = await pedir('/api/conta/criar', { metodo: 'POST', corpo: { email, nome, senha } });
  if (!r.ok) return avisar('aviso-login', r.erro);
  aoEntrar(r);
}

// ------------------------------------------------------------- inicialização

async function iniciarContas() {
  const config = await pedir('/api/conta/config');
  if (config.ok) configDeLogin = config;

  // O ranking aparece antes do login: dá para ver quem está ganhando a semana
  // sem entrar em conta nenhuma.
  carregarRanking();

  if (sessao.ler()) {
    const r = await pedir('/api/conta/eu');
    if (r.ok) return aoEntrar({ token: sessao.ler(), usuario: r.usuario });
    sessao.apagar(); // crachá vencido: cai para a tela de login sem drama
  }
  irPara('entrar');
  $('tela-login').classList.remove('escondida');
}

// ------------------------------------------------------------------ botões

for (const aba of document.querySelectorAll('.aba')) {
  aba.addEventListener('click', () => irPara(aba.dataset.modo));
}

// O servidor recusou a conexão do socket (crachá vencido enquanto a aba estava
// aberta, ou servidor reiniciado sem SESSAO_SEGREDO fixo).
socket.on('connect_error', (erro) => {
  if (String(erro.message) !== 'nao-autenticado') return;
  sessao.apagar();
  sair();
  avisar('aviso-login', 'Sua sessão expirou. Entre de novo.');
});
