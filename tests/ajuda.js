// Ajudantes que todos os testes de socket usam.
//
// Desde que o jogo passou a exigir conta, conectar um socket tem dois passos:
// criar a conta por HTTP e conectar levando o cracha. Isso ficou aqui para nao
// ser copiado em cada arquivo de teste.

const { io } = require('socket.io-client');

// Cria uma conta local nova e devolve { token, usuario }.
async function criarConta(url, nome) {
  const resposta = await fetch(`${url}/api/conta/criar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome, senha: 'senha-de-teste' }),
  });
  const dados = await resposta.json();
  if (!dados.ok) throw new Error(`não consegui criar a conta ${nome}: ${dados.erro}`);
  return dados;
}

// A mesma coisa, mas pela tela: preenche o formulario de login e espera a tela
// sumir. E o caminho que uma pessoa de verdade percorre.
async function entrarNoJogo(pagina, nome, senha = 'senha-de-teste') {
  await pagina.waitForSelector('#tela-login', { state: 'visible', timeout: 10000 });
  await pagina.fill('#login-nome', nome);
  await pagina.fill('#login-senha', senha);
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
    ...extras,
  };
}

module.exports = { criarConta, jogador, entrarNoJogo, ambienteDeTeste };
