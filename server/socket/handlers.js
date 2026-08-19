// Camada de traducao: evento do socket -> acao nos dados -> resposta.
// Regra de ouro: este arquivo nunca decide regras de jogo. Quem decide e server/game/.
//
// Usamos o "acknowledgement" do Socket.IO (o ultimo argumento, uma funcao de resposta)
// para devolver sucesso ou erro direto para quem pediu, em vez de espalhar eventos de erro.

const sala = require('../game/room');
const {
  jogarCarta,
  estadoVisivelPara,
  jogadaAleatoria,
  LIMITE_DO_TURNO_MS,
} = require('../game/gameState');
const ranking = require('../dados/ranking');

// Um relogio por sala. Se o jogador da vez nao jogar dentro do limite, o
// servidor joga uma carta qualquer por ele - senao a partida inteira trava
// esperando alguem que foi fazer outra coisa.
const relogios = new Map();

function cancelarRelogio(codigo) {
  clearTimeout(relogios.get(codigo));
  relogios.delete(codigo);
}

function avisarSala(io, s) {
  io.to(s.codigo).emit('sala-atualizada', sala.resumoDaSala(s));
}

// ------------------------------------------------------------ fim de partida
//
// Uma partida terminada vira pontos no ranking. Chamamos isto em TODO lugar
// onde uma jogada pode ter sido a ultima - inclusive na jogada automatica do
// relogio, senao uma partida decidida no estouro do tempo nao contaria.
//
// Chamar duas vezes e inofensivo de proposito: quem garante isso e o banco (o
// id da partida e chave primaria), nao uma flag que poderia se perder num
// reinicio. Ver registrarPartida em dados/ranking.js.
async function registrarSeAcabou(io, s) {
  if (!s.estado || s.estado.fase !== 'terminado' || !s.estado.resultado) return;

  try {
    const gravado = await ranking.registrarPartida({
      partidaId: s.estado.partidaId,
      sala: s.codigo,
      resultado: s.estado.resultado,
    });
    // So avisa a todos quando a partida entrou agora: repetir o aviso a cada
    // reconexao encheria a tela de todo mundo de atualizacoes iguais.
    if (gravado.novo) {
      io.emit('ranking-atualizado', {
        semana: ranking.semanaAtual(),
        ranking: await ranking.rankingDaSemana(),
      });
    }
  } catch (erro) {
    // O ranking e um extra: se ele falhar, a partida continua valendo na tela.
    // Ninguem espera por esta funcao de proposito - o fim de partida aparece na
    // tela na hora, e a gravacao acontece logo atras.
    console.error('[ranking] não foi possível registrar a partida:', erro);
  }
}

// Cada jogador recebe uma versao diferente do estado: so ele ve a propria mao.
// Os espectadores recebem uma versao sem mao nenhuma e sem previsao.
function avisarEstado(io, s) {
  if (!s.estado) return;

  // Quem esta assistindo e informacao publica: vai junto do estado.
  const plateia = (s.espectadores || []).map((e) => ({ nome: e.nome }));
  const visao = (id, ehEspectador) => ({
    ...estadoVisivelPara(s.estado, id, ehEspectador),
    espectadores: plateia,
  });

  for (const jogador of s.jogadores) {
    if (jogador.socketId) io.to(jogador.socketId).emit('estado-atualizado', visao(jogador.id, false));
  }
  for (const espectador of s.espectadores || []) {
    if (espectador.socketId) {
      io.to(espectador.socketId).emit('estado-atualizado', visao(espectador.id, true));
    }
  }
  agendarRelogio(io, s);
}

// Marca o tempo do jogador da vez. Sempre que o estado muda, o relogio reinicia.
function agendarRelogio(io, s) {
  cancelarRelogio(s.codigo);
  if (!s.estado || s.estado.fase !== 'jogando') return;

  relogios.set(
    s.codigo,
    setTimeout(() => {
      try {
        const viva = sala.salaPorCodigo(s.codigo);
        if (!viva || !viva.estado || viva.estado.fase !== 'jogando') return;

        const jogada = jogadaAleatoria(viva.estado);
        if (!jogada) return;

        jogarCarta(viva.estado, jogada.jogadorId, jogada.uid, jogada.escolha);
        viva.estado.log.push({
          partes: [{ t: 'Tempo esgotado: o jogo escolheu a carta.' }],
          dono: jogada.jogadorId,
        });
        avisarEstado(io, viva); // reagenda sozinho para o proximo jogador
        registrarSeAcabou(io, viva); // a jogada do relogio pode ter sido a ultima
      } catch (erro) {
        console.error('[relogio]', erro);
      }
    }, LIMITE_DO_TURNO_MS)
  );
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
  // QUEM E VOCE vem do cracha conferido no handshake (ver server/index.js), e
  // nunca do que o cliente digitou. Os handlers abaixo ignoram qualquer
  // `jogadorId` ou `nome` enviado pelo navegador - e essa a garantia de que a
  // partida registrada no ranking pertence mesmo a esta conta.
  const eu = () => ({
    id: socket.data.usuario.id,
    nome: socket.data.usuario.nome,
    socketId: socket.id,
  });

  socket.on('criar-sala', (_dados, resposta) => {
    responder(() => {
      const s = sala.criarSala(eu());
      socket.join(s.codigo);
      avisarSala(io, s);
      return { sala: sala.resumoDaSala(s) };
    }, resposta);
  });

  socket.on('entrar-sala', ({ codigo } = {}, resposta) => {
    responder(() => {
      const s = sala.entrarNaSala(codigo, eu());
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
      if (achado.espectador) throw new sala.ErroDeSala('Espectadores não comandam a partida.');
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
      // Trava de segurança: espectador não joga, nem por evento forjado no console.
      if (achado.espectador) throw new sala.ErroDeSala('Você está assistindo, não jogando.');
      jogarCarta(achado.sala.estado, achado.jogador.id, uid, escolha);
      avisarEstado(io, achado.sala);
      registrarSeAcabou(io, achado.sala);
      return {};
    }, resposta);
  });

  // Revanche: todo mundo precisa topar. Um "nao" desfaz a sala inteira.
  socket.on('revanche', ({ quer } = {}, resposta) => {
    responder(() => {
      const achado = sala.salaDoSocket(socket.id);
      if (!achado) throw new sala.ErroDeSala('Você não está em nenhuma sala.');
      if (achado.espectador) throw new sala.ErroDeSala('Quem decide a revanche são os jogadores.');

      const r = sala.votarRevanche(achado.sala.codigo, achado.jogador.id, Boolean(quer));

      if (r.acao === 'encerrada') {
        io.to(r.sala.codigo).emit('sala-encerrada', {
          motivo: `${achado.jogador.nome} preferiu não jogar de novo. A sala foi encerrada.`,
        });
        cancelarRelogio(r.sala.codigo);
        sala.encerrarSala(r.sala.codigo);
        return {};
      }

      avisarSala(io, r.sala);
      if (r.acao === 'nova-partida') avisarEstado(io, r.sala);
      return {};
    }, resposta);
  });

  // Sair no meio da partida encerra a sala: o jogo depende de todo mundo jogar
  // a vez, entao continuar sem alguem so deixaria os outros travados esperando.
  socket.on('sair-sala', (_dados, resposta) => {
    responder(() => {
      const achado = sala.salaDoSocket(socket.id);
      if (!achado) return {};
      // Espectador saindo nao derruba a sala: ele so estava assistindo.
      if (achado.espectador) {
        sala.desconectar(socket.id);
        avisarSala(io, achado.sala);
        return {};
      }
      io.to(achado.sala.codigo).emit('sala-encerrada', {
        motivo: `${achado.jogador.nome} saiu da partida. A sala foi encerrada.`,
      });
      cancelarRelogio(achado.sala.codigo);
      sala.encerrarSala(achado.sala.codigo);
      return {};
    }, resposta);
  });

  socket.on('disconnect', () => {
    const saida = sala.desconectar(socket.id);
    if (!saida) return;
    if (sala.salaPorCodigo(saida.sala.codigo)) avisarSala(io, saida.sala);
    else cancelarRelogio(saida.sala.codigo); // sala apagada: nada de relogio orfao
  });
};
