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
    // Sem SMTP configurado, os e-mails saem no console do servidor de teste -
    // que e exatamente o que precisamos para ler os links sem servidor de
    // e-mail nenhum.
    ...extras,
  };
}

// A CAIXA DE ENTRADA DOS TESTES.
//
// Sem SMTP configurado, o servidor imprime o e-mail inteiro no console - com o
// link. Entao para testar o fluxo de verdade (criar conta -> clicar no link ->
// virar conta confirmada) basta ler a saida do servidor de teste. Nenhuma rota
// secreta de teste precisa existir no servidor, que e exatamente o que
// queremos: o que os testes exercitam e o mesmo caminho de producao.
function capturarEmails(servidor) {
  let texto = '';
  const juntar = (pedaco) => { texto += pedaco.toString(); };
  servidor.stdout.on('data', juntar);
  servidor.stderr.on('data', juntar);

  const PADRAO = {
    verificar: /https?:\/\/\S+\/api\/conta\/verificar\?t=[^\s]+/,
    redefinir: /https?:\/\/\S+\/\?redefinir=[^\s]+/,
  };

  // Cada e-mail impresso comeca com esta faixa (veja server/email/enviar.js).
  const blocos = (endereco) =>
    texto
      .split('──────── E-MAIL')
      .filter((b) => b.includes(`Para: ${endereco}\n`));

  return {
    tudo: () => texto,
    // Quantos e-mails sairam para este endereco ate agora.
    quantos: (endereco) => blocos(endereco).length,
    // O link mais recente daquele tipo, ou null se nao houver nenhum.
    link(endereco, tipo) {
      const lista = blocos(endereco);
      for (let i = lista.length - 1; i >= 0; i--) {
        const achado = lista[i].match(PADRAO[tipo]);
        if (achado) return achado[0];
      }
      return null;
    },
    // So o token do link - util para bater direto na rota.
    token(endereco, tipo) {
      const link = this.link(endereco, tipo);
      return link ? link.split('=').pop() : null;
    },
  };
}

// Confirma o e-mail de uma conta de teste do jeito que uma pessoa faria: pega o
// link que o servidor mandou e abre. So depois disso a conta entra no ranking.
async function confirmarEmail(caixa, nome, endereco = emailDeTeste(nome)) {
  let link = null;
  for (let i = 0; i < 60 && !link; i++) {
    link = caixa.link(endereco, 'verificar');
    if (!link) await new Promise((r) => setTimeout(r, 60));
  }
  if (!link) throw new Error(`nenhum e-mail de confirmação chegou para ${endereco}`);
  const resposta = await fetch(link, { redirect: 'manual' });
  return resposta.headers.get('location') || '';
}

module.exports = {
  criarConta,
  jogador,
  entrarNoJogo,
  ambienteDeTeste,
  emailDeTeste,
  capturarEmails,
  confirmarEmail,
};
