// Ajudantes que todos os testes de socket usam.
//
// Desde que o jogo passou a exigir conta, conectar um socket tem dois passos:
// criar a conta por HTTP e conectar levando o cracha. Isso ficou aqui para nao
// ser copiado em cada arquivo de teste.

const { io } = require('socket.io-client');

// O e-mail de teste de cada apelido. Precisa ser unico por conta.
const emailDeTeste = (nome) => `${String(nome).toLowerCase()}@exemplo.test`;

// Cria uma conta nova (e-mail + apelido + senha) e devolve { token, usuario }.
async function criarConta(url, nome, senha = 'senha-de-teste') {
  const resposta = await fetch(`${url}/api/conta/criar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: emailDeTeste(nome), nome, senha }),
  });
  const dados = await resposta.json();
  if (!dados.ok) throw new Error(`não consegui criar a conta ${nome}: ${dados.erro}`);
  return dados;
}

// A mesma coisa, mas pela tela: percorre o formulario de cadastro como uma
// pessoa faria.
async function entrarNoJogo(pagina, nome, senha = 'senha-de-teste') {
  await pagina.waitForSelector('#tela-login', { state: 'visible', timeout: 10000 });
  await pagina.click('.aba[data-modo="criar"]');
  await pagina.fill('#novo-email', emailDeTeste(nome));
  await pagina.fill('#novo-nome', nome);
  await pagina.fill('#nova-senha', senha);
  await pagina.click('#btn-criar-conta');
  // 'hidden' e o estado certo aqui: a tela de login some, ela nao vira visivel.
  await pagina.waitForSelector('#tela-login', { state: 'hidden', timeout: 10000 });
}

// Uma conta nova + um socket ja conectado com ela.
async function jogador(url, nome) {
  const conta = await criarConta(url, nome);
  const socket = io(url, { auth: { token: conta.token } });
  await new Promise((pronto, falhou) => {
    socket.once('connect', pronto);
    socket.once('connect_error', falhou);
  });
  return { socket, ...conta.usuario, token: conta.token };
}

// O banco dos testes: memoria pura. Cada servidor de teste comeca sem conta
// nenhuma, nada e escrito em disco, e uma suite nunca ve os dados da outra -
// nem encosta no banco de verdade de quem esta desenvolvendo.
function ambienteDeTeste(porta, extras = {}) {
  return {
    ...process.env,
    PORT: porta,
    BANCO_CAMINHO: ':memory:',
    SESSAO_SEGREDO: 'segredo-de-teste',
    NODE_ENV: 'test',
    ...extras,
  };
}

module.exports = { criarConta, jogador, entrarNoJogo, ambienteDeTeste, emailDeTeste };
