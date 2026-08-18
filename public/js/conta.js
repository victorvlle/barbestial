// A tela de login e o que acontece depois dela.
//
// O fluxo inteiro, de cima a baixo:
//   1. a pagina abre e pergunta ao servidor se o cracha guardado ainda vale
//   2. valendo, vai direto para o menu - ninguem digita nada
//   3. nao valendo, aparece a tela de login (Google, se estiver configurado, ou
//      apelido e senha)
//   4. com o cracha na mao, o socket conecta e o jogo comeca a funcionar
//
// Nada aqui decide quem a pessoa e: isso e sempre o servidor. Este arquivo so
// pede, guarda o cracha e desenha o resultado.

let configDeLogin = { google: false, googleClientId: null };

// ------------------------------------------------------------------ entrada

// Ponto unico de "consegui entrar": guarda o cracha, liga o socket e troca de
// tela. Todo caminho de login (Google, senha, conta nova) termina aqui.
function aoEntrar({ token, usuario }) {
  sessao.salvar(token);
  CONTA = usuario;
  JOGADOR_ID = usuario.id;

  $('quem-sou').textContent = usuario.nome;
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
  avisar('aviso-login', 'Você saiu da sua conta.');
}

// ------------------------------------------------------------- conta local

async function criarConta() {
  const nome = $('login-nome').value.trim();
  const senha = $('login-senha').value;
  const r = await pedir('/api/conta/criar', { metodo: 'POST', corpo: { nome, senha } });
  if (!r.ok) return avisar('aviso-login', r.erro);
  aoEntrar(r);
}

async function entrarComSenha() {
  const nome = $('login-nome').value.trim();
  const senha = $('login-senha').value;
  if (!nome || !senha) return avisar('aviso-login', 'Preencha o nome e a senha.');
  const r = await pedir('/api/conta/entrar', { metodo: 'POST', corpo: { nome, senha } });
  if (!r.ok) return avisar('aviso-login', r.erro);
  aoEntrar(r);
}

// ------------------------------------------------------------------ Google
//
// O botao e desenhado pelo proprio Google (biblioteca "Google Identity
// Services"). Ele devolve um cracha assinado - o `credential` - que mandamos
// para o servidor conferir. Senha do Google nunca passa por aqui.

function prepararGoogle() {
  if (!configDeLogin.google || !window.google || !google.accounts) return;

  google.accounts.id.initialize({
    client_id: configDeLogin.googleClientId,
    callback: async ({ credential }) => {
      const r = await pedir('/api/conta/google', {
        metodo: 'POST',
        corpo: { idToken: credential },
      });
      if (!r.ok) return avisar('aviso-login', r.erro);
      aoEntrar(r);
    },
  });

  google.accounts.id.renderButton($('botao-google'), {
    theme: 'filled_black',
    size: 'large',
    shape: 'pill',
    text: 'signin_with',
    locale: 'pt-BR',
    width: 260,
  });
  $('bloco-google').classList.remove('escondida');
}

// ------------------------------------------------------------- inicializacao

async function iniciarContas() {
  const config = await pedir('/api/conta/config');
  if (config.ok) configDeLogin = config;

  // A biblioteca do Google so e baixada se o login com Google estiver ligado:
  // quem nao usa nao carrega script de terceiro nenhum.
  if (configDeLogin.google) {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = prepararGoogle;
    document.head.appendChild(script);
  }

  // O ranking aparece antes do login: dá para ver quem está ganhando a semana
  // sem entrar em conta nenhuma.
  carregarRanking();

  if (sessao.ler()) {
    const r = await pedir('/api/conta/eu');
    if (r.ok) return aoEntrar({ token: sessao.ler(), usuario: r.usuario });
    sessao.apagar(); // cracha vencido: cai para a tela de login sem drama
  }
  $('tela-login').classList.remove('escondida');
}

// O servidor recusou a conexão do socket (cracha vencido enquanto a aba estava
// aberta, ou servidor reiniciado sem SESSAO_SEGREDO fixo).
socket.on('connect_error', (erro) => {
  if (String(erro.message) !== 'nao-autenticado') return;
  sessao.apagar();
  sair();
  avisar('aviso-login', 'Sua sessão expirou. Entre de novo.');
});
