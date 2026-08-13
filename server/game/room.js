// Salas: quem esta esperando para jogar e qual partida pertence a cada sala.
//
// Tudo em memoria (um Map). Se o servidor reiniciar, as salas se perdem - aceitavel
// agora, e da para trocar por banco/Redis mais tarde sem mexer no resto do codigo.
//
// Este arquivo nao conhece Socket.IO de proposito: ele so mexe em dados.
// Assim da para testar sala sem subir servidor nenhum.

const { REGRAS } = require('./cards');
const { criarEstado } = require('./gameState');

const salas = new Map();

// Sem I, O, 0 e 1: as pessoas confundem ao digitar o codigo da sala.
const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CORES = ['vermelho', 'azul', 'verde', 'amarelo'];

class ErroDeSala extends Error {}

function gerarCodigo(aleatorio = Math.random) {
  let codigo;
  do {
    codigo = Array.from(
      { length: 4 },
      () => LETRAS[Math.floor(aleatorio() * LETRAS.length)]
    ).join('');
  } while (salas.has(codigo));
  return codigo;
}

function corLivre(sala) {
  const usadas = sala.jogadores.map((j) => j.cor);
  return CORES.find((c) => !usadas.includes(c));
}

function criarSala(jogador, aleatorio = Math.random) {
  const sala = {
    codigo: gerarCodigo(aleatorio),
    anfitriao: jogador.id,
    jogadores: [],
    estado: null,
    criadaEm: Date.now(),
  };
  salas.set(sala.codigo, sala);
  entrarNaSala(sala.codigo, jogador);
  return sala;
}

function entrarNaSala(codigo, jogador) {
  const sala = salas.get(String(codigo || '').toUpperCase());
  if (!sala) throw new ErroDeSala('Sala não encontrada. Confira o código.');

  const nome = String(jogador.nome || '').trim().slice(0, 16);
  if (!nome) throw new ErroDeSala('Escolha um nome antes de entrar.');

  // Reconexao: o jogador ja estava nesta sala (caiu a internet, recarregou a pagina).
  const jaEstava = sala.jogadores.find((j) => j.id === jogador.id);
  if (jaEstava) {
    jaEstava.socketId = jogador.socketId;
    jaEstava.conectado = true;
    jaEstava.nome = nome;
    return sala;
  }

  if (sala.estado) throw new ErroDeSala('A partida desta sala já começou.');
  if (sala.jogadores.length >= REGRAS.MAX_JOGADORES) {
    throw new ErroDeSala(`A sala já tem ${REGRAS.MAX_JOGADORES} jogadores.`);
  }

  sala.jogadores.push({
    id: jogador.id,
    nome,
    cor: corLivre(sala),
    socketId: jogador.socketId,
    conectado: true,
  });
  return sala;
}

function iniciarPartida(codigo, jogadorId) {
  const sala = salas.get(codigo);
  if (!sala) throw new ErroDeSala('Sala não encontrada.');
  if (sala.anfitriao !== jogadorId) throw new ErroDeSala('Só quem criou a sala pode começar.');
  if (sala.estado) throw new ErroDeSala('A partida já começou.');
  if (sala.jogadores.length < REGRAS.MIN_JOGADORES) {
    throw new ErroDeSala(`São necessários pelo menos ${REGRAS.MIN_JOGADORES} jogadores.`);
  }

  sala.estado = criarEstado(
    sala.jogadores.map((j) => ({ id: j.id, nome: j.nome, cor: j.cor }))
  );
  sala.revanche = {};
  return sala;
}

// ------------------------------------------------------------------ revanche
//
// Regra combinada: a revanche so acontece se TODO MUNDO topar. Basta uma pessoa
// dizer que nao quer e a sala inteira se desfaz - ninguem fica jogando sozinho
// esperando, e ninguem fica presa numa sala que ja acabou.
// Enquanto a votacao acontece, cada voto e visivel para todos.

function votarRevanche(codigo, jogadorId, quer) {
  const sala = salas.get(codigo);
  if (!sala) throw new ErroDeSala('Sala não encontrada.');
  if (!sala.estado || sala.estado.fase !== 'terminado') {
    throw new ErroDeSala('A revanche só vale depois que a partida acaba.');
  }

  sala.revanche = sala.revanche || {};
  sala.revanche[jogadorId] = quer ? 'sim' : 'nao';

  if (!quer) return { acao: 'encerrada', sala, quemSaiu: jogadorId };

  const presentes = sala.jogadores.filter((j) => j.conectado);
  const todosToparam = presentes.every((j) => sala.revanche[j.id] === 'sim');

  if (todosToparam && presentes.length >= REGRAS.MIN_JOGADORES) {
    // Sala nova com a mesma gente: baralhos embaralhados de novo, placar zerado.
    sala.jogadores = presentes;
    sala.anfitriao = presentes[0].id;
    sala.estado = criarEstado(
      presentes.map((j) => ({ id: j.id, nome: j.nome, cor: j.cor }))
    );
    sala.revanche = {};
    return { acao: 'nova-partida', sala };
  }

  return { acao: 'aguardando', sala };
}

function encerrarSala(codigo) {
  salas.delete(codigo);
}

const salaPorCodigo = (codigo) => salas.get(codigo) || null;

function salaDoSocket(socketId) {
  for (const sala of salas.values()) {
    const jogador = sala.jogadores.find((j) => j.socketId === socketId);
    if (jogador) return { sala, jogador };
  }
  return null;
}

// Nao removemos o jogador na hora: ele pode estar so recarregando a pagina.
// Se a partida nem comecou, ai sim sai da lista - senao a sala trava com fantasmas.
function desconectar(socketId) {
  const achado = salaDoSocket(socketId);
  if (!achado) return null;
  const { sala, jogador } = achado;

  jogador.conectado = false;
  jogador.socketId = null;

  // Com a partida encerrada, sair e sair mesmo: nao faz sentido segurar o lugar
  // de alguem numa partida que ja terminou.
  const acabou = sala.estado && sala.estado.fase === 'terminado';

  if (!sala.estado || acabou) {
    sala.jogadores = sala.jogadores.filter((j) => j.id !== jogador.id);
    if (sala.anfitriao === jogador.id && sala.jogadores.length > 0) {
      sala.anfitriao = sala.jogadores[0].id; // alguem precisa poder comecar a partida
    }
  }

  if (sala.jogadores.every((j) => !j.conectado)) {
    salas.delete(sala.codigo); // sala vazia nao fica ocupando memoria
  }
  return { sala, jogador };
}

// O que o lobby precisa mostrar. Nunca inclui cartas.
function resumoDaSala(sala) {
  return {
    codigo: sala.codigo,
    anfitriao: sala.anfitriao,
    emPartida: Boolean(sala.estado),
    minimo: REGRAS.MIN_JOGADORES,
    maximo: REGRAS.MAX_JOGADORES,
    jogadores: sala.jogadores.map((j) => ({
      id: j.id,
      nome: j.nome,
      cor: j.cor,
      conectado: j.conectado,
      revanche: (sala.revanche || {})[j.id] || null, // 'sim' | 'nao' | null
    })),
  };
}

module.exports = {
  salas,
  votarRevanche,
  encerrarSala,
  ErroDeSala,
  criarSala,
  entrarNaSala,
  iniciarPartida,
  desconectar,
  salaDoSocket,
  salaPorCodigo,
  resumoDaSala,
  gerarCodigo,
};
