// A tela de login e o que acontece depois dela.
//
// QUATRO MODOS, uma tela só:
//   entrar     - apelido OU e-mail + senha
//   criar      - e-mail + apelido + senha
//   esqueci    - só o e-mail; recebe o link por e-mail
//   redefinir  - aparece sozinho quando a pessoa chega pelo link do e-mail
//
// POR QUE A RECUPERAÇÃO PEDE E-MAIL E NÃO APELIDO: o apelido aparece no ranking
// para todo mundo. Usá-lo como chave de recuperação transformaria a lista de
// campeões numa lista de alvos. O e-mail ninguém vê.
//
// Nada aqui decide quem a pessoa é: isso é sempre o servidor. Este arquivo só
// pede, guarda o crachá e desenha o resultado.

let configDeLogin = { email: false, senhaMinima: 6 };
let modoAtual = 'entrar';

// O token que veio no link do e-mail (?redefinir=...). Fica só na memória desta
// aba e some assim que é usado.
let tokenDeRecuperacao = null;

// ------------------------------------------------------------------ modos

function irPara(modo) {
  modoAtual = modo;
  avisar('aviso-login', '');

  for (const bloco of document.querySelectorAll('.modo')) bloco.classList.add('escondida');
  $(`modo-${modo}`).classList.remove('escondida');

  // As abas só fazem sentido entre "entrar" e "criar"; os outros são desvios.
  $('abas').classList.toggle('escondida', modo !== 'entrar' && modo !== 'criar');
  for (const aba of document.querySelectorAll('.aba')) {
    aba.classList.toggle('aba--ativa', aba.dataset.modo === modo);
  }
  $('esqueci-ok').classList.add('escondida');
}

// ------------------------------------------------------------------ entrada

// Ponto único de "consegui entrar": guarda o crachá, liga o socket e troca de
// tela. Todo caminho (senha, conta nova, recuperação) termina aqui.
function aoEntrar({ token, usuario }) {
  sessao.salvar(token);
  CONTA = usuario;
  JOGADOR_ID = usuario.id;
  tokenDeRecuperacao = null;

  $('quem-sou').textContent = usuario.nome;
  $('quem-sou').title = usuario.email || '';
  pintarFaixaDeEmail();
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

// A faixa de "confirme seu e-mail". Aparece só enquanto falta confirmar, e
// deixa claro o que está travado: o ranking, não o jogo.
function pintarFaixaDeEmail() {
  const falta = CONTA && !CONTA.verificado;
  $('faixa-email').classList.toggle('escondida', !falta);
  $('bloco-trocar-email').classList.add('escondida');
  avisar('aviso-email', '');
  if (falta) $('email-pendente').textContent = CONTA.email || '—';
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

// "Esqueci minha senha". A resposta é sempre a mesma, exista a conta ou não -
// o servidor não conta quem tem cadastro aqui, e a tela não pode contar também.
async function pedirRecuperacao() {
  const email = $('esqueci-email').value.trim();
  if (!email) return avisar('aviso-login', 'Digite seu e-mail.');

  const r = await pedir('/api/conta/esqueci', { metodo: 'POST', corpo: { email } });
  if (!r.ok) return avisar('aviso-login', r.erro);

  $('esqueci-ok').textContent = r.mensagem;
  $('esqueci-ok').classList.remove('escondida');
  avisar('aviso-login', '');
}

async function salvarNovaSenha() {
  const novaSenha = $('senha-nova').value;
  if (!tokenDeRecuperacao) return avisar('aviso-login', 'Link inválido. Peça outro.');

  const r = await pedir('/api/conta/redefinir', {
    metodo: 'POST',
    corpo: { token: tokenDeRecuperacao, novaSenha },
  });
  if (!r.ok) return avisar('aviso-login', r.erro);
  limparEndereco();
  aoEntrar(r);
}

// ------------------------------------------------- confirmação do e-mail

async function reenviarConfirmacao() {
  avisar('aviso-email', '');
  const r = await pedir('/api/conta/reenviar', { metodo: 'POST' });
  if (!r.ok) return avisar('aviso-email', r.erro);
  if (r.jaVerificado) return atualizarConta();
  avisar('aviso-email', 'Enviado. Olhe também a caixa de spam.');
}

async function salvarEmailNovo() {
  const email = $('email-novo').value.trim();
  const r = await pedir('/api/conta/trocar-email', { metodo: 'POST', corpo: { email } });
  if (!r.ok) return avisar('aviso-email', r.erro);
  CONTA = r.usuario;
  pintarFaixaDeEmail();
  avisar('aviso-email', 'E-mail atualizado. Enviamos um link novo.');
}

// Relê a conta no servidor - usado depois de confirmar o e-mail em outra aba.
async function atualizarConta() {
  const r = await pedir('/api/conta/eu');
  if (!r.ok) return;
  CONTA = r.usuario;
  pintarFaixaDeEmail();
  carregarRanking(); // confirmou: a pontuação passa a aparecer
}

// ------------------------------------------------------------- endereço

// Tira os parâmetros da URL depois de usá-los, para o link de recuperação não
// ficar no histórico do navegador nem ser reaberto sem querer.
function limparEndereco() {
  history.replaceState(null, '', location.pathname);
}

// O que veio no endereço: ?redefinir=<token> ou ?verificado=1|0
function lerEndereco() {
  const p = new URLSearchParams(location.search);
  return { redefinir: p.get('redefinir'), verificado: p.get('verificado') };
}

// ------------------------------------------------------------- inicialização

async function iniciarContas() {
  const config = await pedir('/api/conta/config');
  if (config.ok) configDeLogin = config;

  const endereco = lerEndereco();

  // O ranking aparece antes do login: dá para ver quem está ganhando a semana
  // sem entrar em conta nenhuma.
  carregarRanking();

  // Voltou do link de confirmação. O recado só pode ser pintado depois de
  // sabermos ONDE a pessoa vai parar: quem clicou no link do e-mail pode chegar
  // aqui deslogada (outro navegador, outro celular), e aí o aviso do menu está
  // escondido - a mensagem tem que aparecer na tela de login.
  let recado = '';
  if (endereco.verificado !== null) {
    limparEndereco();
    recado =
      endereco.verificado === '1'
        ? 'E-mail confirmado! Sua pontuação já vale no ranking.'
        : 'O link de confirmação não vale mais. Entre e peça um novo.';
  }

  // Chegou pelo link de recuperação: a tela de nova senha tem prioridade sobre
  // qualquer sessão que já exista nesta aba.
  if (endereco.redefinir) {
    tokenDeRecuperacao = endereco.redefinir;
    irPara('redefinir');
    $('tela-login').classList.remove('escondida');
    return;
  }

  if (sessao.ler()) {
    const r = await pedir('/api/conta/eu');
    if (r.ok) {
      aoEntrar({ token: sessao.ler(), usuario: r.usuario });
      if (recado) avisar('aviso-entrada', recado);
      return;
    }
    sessao.apagar(); // crachá vencido: cai para a tela de login sem drama
  }
  irPara('entrar'); // irPara limpa o aviso, então o recado vem depois dele
  if (recado) avisar('aviso-login', recado);
  $('tela-login').classList.remove('escondida');
}

// ------------------------------------------------------------------ botões

for (const aba of document.querySelectorAll('.aba')) {
  aba.addEventListener('click', () => irPara(aba.dataset.modo));
}

// Voltar para a aba do jogo depois de confirmar o e-mail em outra: relê a conta
// para a faixa sumir sozinha, sem a pessoa precisar recarregar a página.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && CONTA && !CONTA.verificado) atualizarConta();
});

// O servidor recusou a conexão do socket (crachá vencido enquanto a aba estava
// aberta, ou servidor reiniciado sem SESSAO_SEGREDO fixo).
socket.on('connect_error', (erro) => {
  if (String(erro.message) !== 'nao-autenticado') return;
  sessao.apagar();
  sair();
  avisar('aviso-login', 'Sua sessão expirou. Entre de novo.');
});
