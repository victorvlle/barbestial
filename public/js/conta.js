// A tela de login e o que acontece depois dela.
//
// TRES MODOS, uma tela só:
//   entrar     - apelido+senha OU o botão do Google (qualquer um serve)
//   criar      - apelido + senha + Google, os três obrigatórios
//   recuperar  - só o Google, e SEM campo de apelido
//
// POR QUE A RECUPERAÇÃO NÃO PERGUNTA O APELIDO: se perguntasse, saber o apelido
// de alguém seria o primeiro passo para roubar a conta. Aqui a conta é
// encontrada pelo Google em que a pessoa acabou de entrar - não por um nome
// digitado. Quem não tiver acesso àquele Google não tem por onde começar.
//
// Nada aqui decide quem a pessoa é: isso é sempre o servidor. Este arquivo só
// pede, guarda o crachá e desenha o resultado.

let configDeLogin = { google: false, googleClientId: null, senhaMinima: 6 };

// O crachá que o Google devolveu, guardado só na memória desta aba - nunca em
// localStorage. Ele vale poucos minutos e serve para uma operação só.
let credencialGoogle = null;
let modoAtual = 'entrar';

// ------------------------------------------------------------------ modos

function irPara(modo) {
  modoAtual = modo;
  credencialGoogle = null;
  avisar('aviso-login', '');

  for (const bloco of document.querySelectorAll('.modo')) {
    bloco.classList.add('escondida');
  }
  $(`modo-${modo}`).classList.remove('escondida');

  // As abas só fazem sentido entre "entrar" e "criar"; a recuperação é um desvio.
  $('abas').classList.toggle('escondida', modo === 'recuperar');
  for (const aba of document.querySelectorAll('.aba')) {
    aba.classList.toggle('aba--ativa', aba.dataset.modo === modo);
  }

  // Estado limpo toda vez que se troca de modo.
  $('google-criar-ok').classList.add('escondida');
  $('google-recuperar-ok').classList.add('escondida');
  $('bloco-nova-senha').classList.add('escondida');
  $('btn-criar-conta').disabled = true;
}

// ------------------------------------------------------------------ entrada

// Ponto único de "consegui entrar": guarda o crachá, liga o socket e troca de
// tela. Todo caminho (senha, Google, conta nova, recuperação) termina aqui.
function aoEntrar({ token, usuario }) {
  sessao.salvar(token);
  CONTA = usuario;
  JOGADOR_ID = usuario.id;
  credencialGoogle = null;

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
  irPara('entrar');
  avisar('aviso-login', 'Você saiu da sua conta.');
}

// --------------------------------------------------------------- formulários

async function entrarComSenha() {
  const nome = $('login-nome').value.trim();
  const senha = $('login-senha').value;
  if (!nome || !senha) return avisar('aviso-login', 'Preencha o apelido e a senha.');

  const r = await pedir('/api/conta/entrar', { metodo: 'POST', corpo: { nome, senha } });
  if (!r.ok) return avisar('aviso-login', r.erro);
  aoEntrar(r);
}

async function criarConta() {
  const nome = $('novo-nome').value.trim();
  const senha = $('nova-senha').value;
  if (!credencialGoogle) {
    return avisar('aviso-login', 'Conecte sua conta do Google para concluir.');
  }
  const r = await pedir('/api/conta/criar', {
    metodo: 'POST',
    corpo: { nome, senha, idToken: credencialGoogle },
  });
  if (!r.ok) return avisar('aviso-login', r.erro);
  aoEntrar(r);
}

async function salvarNovaSenha() {
  const novaSenha = $('senha-nova').value;
  if (!credencialGoogle) return avisar('aviso-login', 'Confirme no Google primeiro.');

  const r = await pedir('/api/conta/recuperar', {
    metodo: 'POST',
    corpo: { idToken: credencialGoogle, novaSenha },
  });
  if (!r.ok) return avisar('aviso-login', r.erro);
  aoEntrar(r);
}

// ------------------------------------------------------------------ Google
//
// O botão é desenhado pela própria biblioteca do Google ("Google Identity
// Services"). Ela devolve um crachá assinado - o `credential` - e o que fazemos
// com ele depende do modo em que a tela está. Senha do Google nunca passa aqui.

async function aoReceberDoGoogle({ credential }) {
  credencialGoogle = credential;

  if (modoAtual === 'entrar') {
    const r = await pedir('/api/conta/google', { metodo: 'POST', corpo: { idToken: credential } });
    if (!r.ok) return avisar('aviso-login', r.erro);
    return aoEntrar(r);
  }

  if (modoAtual === 'criar') {
    $('google-criar-ok').textContent = '✓ Google conectado';
    $('google-criar-ok').classList.remove('escondida');
    $('btn-criar-conta').disabled = false;
    return avisar('aviso-login', '');
  }

  // recuperar: confirmado o Google, aí sim aparece o campo da senha nova.
  $('google-recuperar-ok').textContent = '✓ Google confirmado';
  $('google-recuperar-ok').classList.remove('escondida');
  $('bloco-nova-senha').classList.remove('escondida');
  $('senha-nova').focus();
  avisar('aviso-login', '');
}

function prepararGoogle() {
  if (!configDeLogin.google || !window.google || !google.accounts) return googleFalhou();

  google.accounts.id.initialize({
    client_id: configDeLogin.googleClientId,
    callback: aoReceberDoGoogle,
  });

  // Um botão em cada modo. Todos caem no mesmo callback; quem decide o que
  // fazer com o crachá é o modo em que a tela está.
  const estilo = { theme: 'filled_black', size: 'large', shape: 'pill', locale: 'pt-BR', width: 260 };
  google.accounts.id.renderButton($('google-entrar'), { ...estilo, text: 'signin_with' });
  google.accounts.id.renderButton($('google-criar'), { ...estilo, text: 'continue_with' });
  google.accounts.id.renderButton($('google-recuperar'), { ...estilo, text: 'continue_with' });
  $('google-entrar-bloco').classList.remove('escondida');
  googlePronto = true;
}

// O botão do Google vem de um script de fora. Bloqueador de anúncios, rede da
// empresa ou uma queda do lado do Google fazem esse script não carregar - e aí
// a pessoa fica olhando um espaço vazio sem entender por que não consegue se
// cadastrar. Este aviso troca o vazio por uma explicação.
let googlePronto = false;
function googleFalhou() {
  if (googlePronto) return;
  $('sem-google').textContent =
    'Não foi possível carregar o botão do Google. Verifique sua conexão ou algum ' +
    'bloqueador de anúncios e recarregue a página.';
  $('sem-google').classList.remove('escondida');
  $('btn-criar-conta').disabled = true;
}

// ------------------------------------------------------------- inicialização

async function iniciarContas() {
  const config = await pedir('/api/conta/config');
  if (config.ok) configDeLogin = config;

  // Sem Google configurado no servidor, ninguém consegue se cadastrar - e é
  // melhor dizer isso do que deixar um formulário que sempre falha.
  if (!configDeLogin.google) {
    $('sem-google').classList.remove('escondida');
    $('btn-criar-conta').disabled = true;
  } else if (configDeLogin.googleClientId) {
    // A biblioteca do Google só é baixada quando há Google de verdade: em modo
    // de teste não existe script externo nenhum para carregar.
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = prepararGoogle;
    script.onerror = googleFalhou;
    // Rede de segurança: o script pode "carregar" e mesmo assim não desenhar
    // nada (client_id errado, por exemplo). Depois de 6s sem botão, avisamos.
    setTimeout(googleFalhou, 6000);
    document.head.appendChild(script);
  }

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
