// Ajudantes que todos os testes de socket usam.
//
// Desde que o jogo passou a exigir conta, conectar um socket tem dois passos:
// criar a conta por HTTP e conectar levando o cracha. Isso ficou aqui para nao
// ser copiado em cada arquivo de teste.

const { io } = require('socket.io-client');

// Um cracha falso do Google, aceito so quando GOOGLE_MODO_TESTE=1 e o servidor
// NAO esta em producao (ver server/auth/google.js). Cada nome vira uma conta
// Google diferente, como aconteceria na vida real.
const crachaDeTeste = (nome) => `teste:${nome}:${nome.toLowerCase()}@exemplo.test`;

// Cria uma conta nova (apelido + senha + Google) e devolve { token, usuario }.
async function criarConta(url, nome, senha = 'senha-de-teste') {
  const resposta = await fetch(`${url}/api/conta/criar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome, senha, idToken: crachaDeTeste(nome) }),
  });
  const dados = await resposta.json();
  if (!dados.ok) throw new Error(`não consegui criar a conta ${nome}: ${dados.erro}`);
  return dados;
}

// A mesma coisa, mas pela tela: percorre o formulario de cadastro como uma
// pessoa faria. O botao do Google nao existe em modo de teste (a biblioteca
// dele nao e carregada), entao a pagina recebe o cracha falso pela mesma funcao
// que o botao chamaria - o resto do caminho e idêntico.
async function entrarNoJogo(pagina, nome, senha = 'senha-de-teste') {
  await pagina.waitForSelector('#tela-login', { state: 'visible', timeout: 10000 });
  await pagina.click('.aba[data-modo="criar"]');
  await pagina.fill('#novo-nome', nome);
  await pagina.fill('#nova-senha', senha);
  await pagina.evaluate((cracha) => aoReceberDoGoogle({ credential: cracha }), crachaDeTeste(nome));
  await pagina.waitForSelector('#btn-criar-conta:not([disabled])', { timeout: 5000 });
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
    // Sem isto nao ha como testar o cadastro: ele exige um cracha do Google, e
    // nao da para gerar um de verdade sem navegador e conta real. A trava que
    // impede isso de vazar para producao esta em server/auth/google.js.
    GOOGLE_MODO_TESTE: '1',
    NODE_ENV: 'test',
    ...extras,
  };
}

module.exports = { criarConta, jogador, entrarNoJogo, ambienteDeTeste, crachaDeTeste };
