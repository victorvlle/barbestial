// Ponto de entrada do servidor.
// Responsabilidades: servir os arquivos do frontend e abrir o canal de tempo real.
// A logica de jogo NAO mora aqui - ela fica em server/game/.

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const registrarHandlers = require('./socket/handlers');
const { ANIMAIS, REGRAS } = require('./game/cards');
const festas = require('./game/festas');
const { salas } = require('./game/room');
const { abrir } = require('./dados/banco');
const { lerSessao, paraOCliente } = require('./dados/usuarios');
const { router: rotasDeConta } = require('./rotas/contas');
const admin = require('./rotas/admin');

const salasAtivas = () => salas.size;

// Porta padrao do projeto. Para usar outra sem mexer no codigo:
//   PowerShell:  $env:PORT=4000; npm run dev
const PORT = process.env.PORT || 3001;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// O banco e aberto (e migrado) ANTES de o servidor comecar a ouvir - ver o fim
// deste arquivo. Falhar ali e melhor do que falhar no meio de uma partida.

app.use(express.json({ limit: '16kb' })); // corpo das rotas de conta

// AS MUSICAS vem da pasta configurada em festas.js (por padrao dentro de
// public/). Montada a parte de proposito: assim da para mover o audio para
// outro disco - ou para outro servidor - sem mexer em mais nada.
app.use('/assets/festas', express.static(festas.PASTA));

// Tudo dentro de public/ vira URL publica. Ex: public/css/style.css -> /css/style.css
app.use(express.static(path.join(__dirname, '..', 'public')));

// Contas e ranking. Ver server/rotas/contas.js.
app.use('/api', rotasDeConta);

// Painel de administracao. So e montado se ADMIN_SEGREDO existir: sem a
// variavel, /admin responde 404 como qualquer endereco inventado - e nao como
// uma porta destrancada.
if (admin.ligado()) {
  app.use('/', admin.router);
  console.log('[admin] painel disponível em /admin');
}

// O cliente busca a lista de animais daqui, em vez de ter uma copia propria.
// Assim cards.js continua sendo a unica fonte de verdade sobre as cartas.
app.get('/api/animais', (_req, res) => res.json({ animais: ANIMAIS, regras: REGRAS }));

// As festas (playlists) e - o que mais importa - quais faixas existem mesmo no
// disco. O player so oferece festa que tem arquivo.
app.get('/api/festas', (_req, res) => res.json({ ok: true, festas: festas.catalogo() }));

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
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    const usuario = await lerSessao(token);
    if (!usuario) return next(new Error('nao-autenticado'));
    socket.data.usuario = paraOCliente(usuario);
    next();
  } catch (erro) {
    // Banco fora do ar na hora de conectar: recusa como qualquer nao-autenticado,
    // mas deixa registrado o motivo de verdade no log.
    console.error('[socket] não consegui conferir a sessão:', erro.message);
    next(new Error('nao-autenticado'));
  }
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

// O que ha de musica, no log da subida: e o jeito de saber que a pasta esta
// certa sem entrar no jogo e esperar o silencio.
function conferirMusicas() {
  const linhas = festas.resumo();
  const vazias = festas.catalogo().filter((f) => f.total === 0);
  for (const linha of linhas) console.log(`[festas] ${linha}`);
  if (vazias.length) {
    console.log('[festas] festa sem arquivo não aparece no menu. Ver public/assets/festas/LEIA.md');
  }
}

abrir()
  .then(() => {
    conferirMusicas();
    server.listen(PORT, () => {
      const onde = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
      console.log(`\n  Bar Bestial rodando em ${onde}\n`);
    });
  })
  .catch((erro) => {
    console.error('\n  Não consegui abrir o banco de dados:', erro.message);
    console.error('  Confira TURSO_URL e TURSO_TOKEN (ou BANCO_CAMINHO, no ambiente local).\n');
    process.exit(1);
  });
