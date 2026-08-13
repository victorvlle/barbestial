// Camada de traducao: evento do socket -> acao nos dados -> resposta.
// Regra de ouro: este arquivo nunca decide regras de jogo. Quem decide e server/game/.
//
// Usamos o "acknowledgement" do Socket.IO (o ultimo argumento, uma funcao de resposta)
// para devolver sucesso ou erro direto para quem pediu, em vez de espalhar eventos de erro.

const sala = require('../game/room');
const { jogarCarta, estadoVisivelPara } = require('../game/gameState');

function avisarSala(io, s) {
  io.to(s.codigo).emit('sala-atualizada', sala.resumoDaSala(s));
}

// Cada jogador recebe uma versao diferente do estado: so ele ve a propria mao.
function avisarEstado(io, s) {
  if (!s.estado) return;
  for (const jogador of s.jogadores) {
    if (jogador.socketId) {
      io.to(jogador.socketId).emit('estado-atualizado', estadoVisivelPara(s.estado, jogador.id));
    }
  }
}

// Envolve cada handler para que um erro previsto vire uma resposta amigavel,
// e um erro inesperado apareca no console do servidor em vez de derrubar tudo.
function responder(acao, resposta) {
  try {
    const dados = acao() || {};
    if (typeof resposta === 'function') resposta({ ok: true, ...dados });
  } catch (erro) {
    if (!(erro instanceof sala.ErroDeSala)) console.error('[erro]', erro);
    if (typeof resposta === 'function') resposta({ ok: false, erro: erro.message });
  }
}

module.exports = function registrarHandlers(io, socket) {
  socket.on('criar-sala', ({ jogadorId, nome } = {}, resposta) => {
    responder(() => {
      const s = sala.criarSala({ id: jogadorId, nome, socketId: socket.id });
      socket.join(s.codigo);
      avisarSala(io, s);
      return { sala: sala.resumoDaSala(s) };
    }, resposta);
  });

  socket.on('entrar-sala', ({ codigo, jogadorId, nome } = {}, resposta) => {
    responder(() => {
      const s = sala.entrarNaSala(codigo, { id: jogadorId, nome, socketId: socket.id });
      socket.join(s.codigo);
      avisarSala(io, s);
      avisarEstado(io, s); // caso seja uma reconexao no meio da partida
      return { sala: sala.resumoDaSala(s) };
    }, resposta);
  });

  socket.on('iniciar-partida', (_dados, resposta) => {
    responder(() => {
      const achado = sala.salaDoSocket(socket.id);
      if (!achado) throw new sala.ErroDeSala('Você não está em nenhuma sala.');
      const s = sala.iniciarPartida(achado.sala.codigo, achado.jogador.id);
      avisarSala(io, s);
      avisarEstado(io, s);
      return {};
    }, resposta);
  });

  // Ja fica pronto para o passo 4, quando a tela do jogo virar clicavel.
  socket.on('jogar-carta', ({ uid, escolha } = {}, resposta) => {
    responder(() => {
      const achado = sala.salaDoSocket(socket.id);
      if (!achado || !achado.sala.estado) throw new sala.ErroDeSala('Nenhuma partida em andamento.');
      jogarCarta(achado.sala.estado, achado.jogador.id, uid, escolha);
      avisarEstado(io, achado.sala);
      return {};
    }, resposta);
  });

  socket.on('disconnect', () => {
    const saida = sala.desconectar(socket.id);
    if (saida && sala.salaPorCodigo(saida.sala.codigo)) avisarSala(io, saida.sala);
  });
};
