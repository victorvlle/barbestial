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

const salasAtivas = () => salas.size;

// Porta padrao do projeto. Para usar outra sem mexer no codigo:
//   PowerShell:  $env:PORT=4000; npm run dev
const PORT = process.env.PORT || 3001;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Tudo dentro de public/ vira URL publica. Ex: public/css/style.css -> /css/style.css
app.use(express.static(path.join(__dirname, '..', 'public')));

// O cliente busca a lista de animais daqui, em vez de ter uma copia propria.
// Assim cards.js continua sendo a unica fonte de verdade sobre as cartas.
app.get('/api/animais', (_req, res) => res.json({ animais: ANIMAIS, regras: REGRAS }));

// Sinal de vida. A hospedagem chama esta rota para saber se o servidor subiu
// antes de mandar gente para a versao nova.
app.get('/saude', (_req, res) => res.json({ ok: true, salas: salasAtivas() }));

io.on('connection', (socket) => {
  console.log('[socket] conectou:', socket.id);
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
