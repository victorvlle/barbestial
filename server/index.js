// Ponto de entrada do servidor.
// Responsabilidades: servir os arquivos do frontend e abrir o canal de tempo real.
// A logica de jogo NAO mora aqui - ela fica em server/game/.

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const registrarHandlers = require('./socket/handlers');
const { ANIMAIS, REGRAS } = require('./game/cards');
const { salas } = require('./game/room');
const { abrir } = require('./dados/banco');
const { lerSessao, paraOCliente } = require('./dados/usuarios');
const { router: rotasDeConta } = require('./rotas/contas');

const salasAtivas = () => salas.size;

// Porta padrao do projeto. Para usar outra sem mexer no codigo:
//   PowerShell:  $env:PORT=4000; npm run dev
const PORT = process.env.PORT || 3001;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Abre (e cria, na primeira vez) o banco antes de aceitar qualquer pedido.
// Falhar aqui e melhor do que falhar no meio de uma partida.
abrir();

app.use(express.json({ limit: '16kb' })); // corpo das rotas de conta

// Tudo dentro de public/ vira URL publica. Ex: public/css/style.css -> /css/style.css
app.use(express.static(path.join(__dirname, '..', 'public')));

// Contas e ranking. Ver server/rotas/contas.js.
app.use('/api', rotasDeConta);

// O cliente busca a lista de animais daqui, em vez de ter uma copia propria.
// Assim cards.js continua sendo a unica fonte de verdade sobre as cartas.
app.get('/api/animais', (_req, res) => res.json({ animais: ANIMAIS, regras: REGRAS }));

// Sinal de vida. A hospedagem chama esta rota para saber se o servidor subiu
// antes de mandar gente para a versao nova.
app.get('/saude', (_req, res) => res.json({ ok: true, salas: salasAtivas() }));

// PORTA DE ENTRADA DO TEMPO REAL: ninguem passa daqui sem um cracha valido.
//
// Isso muda uma coisa importante no jogo: o identificador do jogador nao vem
// mais do navegador, vem da conta. Antes o cliente mandava um `jogadorId` que
// ele mesmo tinha inventado; agora quem diz quem voce e e a assinatura da
// sessao. Um jogador nao consegue mais se passar por outro nem jogar a carta
// de quem esta do lado, mesmo forjando eventos pelo console.
io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  const usuario = lerSessao(token);
  if (!usuario) return next(new Error('nao-autenticado'));
  socket.data.usuario = paraOCliente(usuario);
  next();
});

io.on('connection', (socket) => {
  console.log('[socket] conectou:', socket.id, '-', socket.data.usuario.nome);
  registrarHandlers(io, socket);
});

// Mensagem amigavel quando a porta ja esta ocupada, em vez do erro cru do Node.
server.on('error', (erro) => {
  if (erro.code === 'EADDRINUSE') {
    console.error(`\n  A porta ${PORT} ja esta em uso.`);
    console.error('  Provavelmente ha outro servidor rodando em outra janela do terminal.');
    console.error('  Solucoes:');
    console.error('    1) Feche o outro terminal (Ctrl+C nele), ou');
    console.error('    2) Rode em outra porta:  $env:PORT=4000; npm run dev\n');
    process.exit(1);
  }
  throw erro;
});

server.listen(PORT, () => {
  const onde = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  console.log(`\n  Bar Bestial rodando em ${onde}\n`);
});
