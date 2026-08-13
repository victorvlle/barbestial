// Cria e manipula o estado de UMA partida.
// Este objeto e a unica fonte de verdade. O cliente nunca decide nada.

const { REGRAS, buscarAnimal } = require('./cards');
const { prepararJogador, comprar } = require('./deck');
const { jogarNaFila, simularJogada, forcaDe } = require('./queue');

const CORES = ['vermelho', 'azul', 'verde', 'amarelo'];

// Tempo que cada jogador tem para jogar. Passou disso, o servidor joga por ele.
// A variavel de ambiente existe para os testes poderem usar 3 segundos em vez
// de esperar 35 - e, de quebra, da para ajustar sem mexer no codigo.
const LIMITE_DO_TURNO_MS = Number(process.env.LIMITE_TURNO_MS) || 35_000;

function criarEstado(jogadores, aleatorio = Math.random) {
  if (jogadores.length < REGRAS.MIN_JOGADORES || jogadores.length > REGRAS.MAX_JOGADORES) {
    throw new Error(`O jogo é para ${REGRAS.MIN_JOGADORES} a ${REGRAS.MAX_JOGADORES} jogadores.`);
  }

  // Identifica esta partida. Entra no uid de cada carta - ver deck.js.
  const partidaId = Math.floor(aleatorio() * 1e9).toString(36);

  return {
    fase: 'jogando',
    partidaId,
    jogadores: jogadores.map((j, i) =>
      prepararJogador({ id: j.id, nome: j.nome, cor: j.cor || CORES[i] }, aleatorio, partidaId)
    ),
    vezDe: 0, // indice em jogadores
    fila: [], // fila[0] = colado na porta do bar
    bar: [], // quem entrou - isso e a pontuacao
    ralo: [], // quem foi expulso
    log: [],
    quadros: [], // fotos do tabuleiro durante a ultima jogada, para animar
    jogadas: 0, // contador: o cliente usa para saber se ha jogada nova para animar
    turnoIniciadoEm: Date.now(), // para o relogio de 35 segundos
    vencedores: null,
  };
}

const jogadorPor = (estado, id) => estado.jogadores.find((j) => j.id === id);
const temCartas = (jogador) => jogador.mao.length > 0;

// A partida acaba quando todos jogaram as 12 cartas.
function acabou(estado) {
  return estado.jogadores.every((j) => j.mao.length === 0 && j.baralho.length === 0);
}

function passarAVez(estado) {
  for (let i = 1; i <= estado.jogadores.length; i++) {
    const proximo = (estado.vezDe + i) % estado.jogadores.length;
    if (temCartas(estado.jogadores[proximo])) {
      estado.vezDe = proximo;
      return;
    }
  }
}

// Alguns poderes precisam de uma decisao do jogador antes de resolver.
function escolhaNecessaria(animalId) {
  return buscarAnimal(animalId)?.escolha || null;
}

function jogarCarta(estado, jogadorId, uid, escolha = null) {
  if (estado.fase !== 'jogando') throw new Error('A partida não está em andamento.');

  const jogador = jogadorPor(estado, jogadorId);
  if (!jogador) throw new Error('Você não está nesta partida.');
  if (estado.jogadores[estado.vezDe].id !== jogadorId) throw new Error('Não é a sua vez.');

  const indice = jogador.mao.findIndex((c) => c.uid === uid);
  if (indice === -1) throw new Error('Essa carta não está na sua mão.');

  const [carta] = jogador.mao.splice(indice, 1);
  estado.log.push({
    partes: [
      { t: `${jogador.nome} jogou ` },
      { t: buscarAnimal(carta.animal).nome, dono: jogador.id },
      { t: '.' },
    ],
    dono: jogador.id,
  });

  const resultado = jogarNaFila(estado, carta, escolha); // passos 1 a 4
  comprar(jogador); // passo 5
  estado.jogadas++;

  estado.turnoIniciadoEm = Date.now();

  if (acabou(estado)) {
    estado.fase = 'terminado';
    estado.resultado = calcularResultado(estado);
    estado.vencedores = estado.resultado.vencedores;
  } else {
    passarAVez(estado);
  }

  return resultado;
}

// Vence quem colocou mais animais proprios no bar.
// Empate: ganha quem tiver a MENOR soma de forcas entre os animais que entraram.
function placar(estado) {
  return estado.jogadores.map((j) => {
    const meus = estado.bar.filter((c) => c.dono === j.id);
    return {
      id: j.id,
      nome: j.nome,
      cor: j.cor,
      entraram: meus.length,
      somaForcas: meus.reduce((total, c) => total + forcaDe(c), 0),
    };
  });
}

// Devolve nao so quem ganhou, mas POR QUE - a tela final explica o desempate.
function calcularResultado(estado) {
  const tabela = placar(estado).sort(
    (a, b) => b.entraram - a.entraram || a.somaForcas - b.somaForcas
  );
  const maisAnimais = Math.max(...tabela.map((p) => p.entraram));
  const empatados = tabela.filter((p) => p.entraram === maisAnimais);

  if (empatados.length === 1) {
    return { vencedores: empatados, criterio: 'animais', empatados, tabela };
  }

  const menorSoma = Math.min(...empatados.map((p) => p.somaForcas));
  const vencedores = empatados.filter((p) => p.somaForcas === menorSoma);
  return {
    // Empate no numero de animais: decide a MENOR soma de forcas.
    vencedores,
    criterio: vencedores.length === empatados.length ? 'empate-total' : 'forca',
    empatados,
    tabela,
  };
}

// Mantida por compatibilidade com os testes e com quem so quer a lista.
function calcularVencedores(estado) {
  return calcularResultado(estado).vencedores;
}

// Todas as decisoes possiveis para uma carta, num lugar so: serve para a
// pre-visualizacao (uma simulacao por opcao) e para o relogio, que sorteia uma
// delas quando o tempo do jogador acaba.
function opcoesDeEscolha(estado, carta) {
  const tipo = buscarAnimal(carta.animal).escolha;
  if (!tipo) return [];

  if (tipo === 'animal') {
    return estado.fila.map((alvo) => ({
      chave: `alvo:${alvo.uid}`,
      escolha: { alvoUid: alvo.uid },
    }));
  }

  if (tipo === 'pular1ou2') {
    return [1, 2]
      .filter((pulos) => pulos <= estado.fila.length)
      .map((pulos) => ({ chave: `pulos:${pulos}`, escolha: { pulos } }));
  }

  if (tipo === 'especie') {
    const especies = [...new Set(estado.fila.map((c) => c.animal))].filter((e) => e !== 'camaleao');
    return especies.map((especie) => {
      // Se a especie copiada tambem pede decisao, resolvemos a mais simples.
      const escolha = { especie };
      const sub = buscarAnimal(especie).escolha;
      if (sub === 'pular1ou2') escolha.pulos = 1;
      if (sub === 'animal') escolha.alvoUid = estado.fila[0]?.uid;
      return { chave: `especie:${especie}`, escolha };
    });
  }
  return [];
}

// Uma jogada qualquer, valida, para quando o tempo do jogador acaba.
function jogadaAleatoria(estado, aleatorio = Math.random) {
  if (estado.fase !== 'jogando') return null;
  const jogador = estado.jogadores[estado.vezDe];
  if (!jogador || jogador.mao.length === 0) return null;

  const carta = jogador.mao[Math.floor(aleatorio() * jogador.mao.length)];
  const opcoes = opcoesDeEscolha(estado, carta);
  const escolha = opcoes.length ? opcoes[Math.floor(aleatorio() * opcoes.length)].escolha : null;
  return { jogadorId: jogador.id, uid: carta.uid, escolha, animal: carta.animal };
}

// Pre-visualizacao: para cada carta da mao de quem esta na vez, simula a jogada
// e guarda como a fila ficaria. Inclui uma simulacao por opcao nas cartas que
// pedem decisao (papagaio, canguru, camaleao), para o jogador poder comparar.
//
// So calculamos para quem esta na vez: sao poucas simulacoes e elas ficam
// prontas antes do jogador passar o mouse, sem ida e volta pela rede.
function preverJogadas(estado, jogador) {
  if (estado.fase !== 'jogando') return {};
  if (estado.jogadores[estado.vezDe]?.id !== jogador.id) return {};

  const previsoes = {};
  for (const carta of jogador.mao) {
    const previsao = { padrao: simularJogada(estado, carta, null), opcoes: {} };
    for (const opcao of opcoesDeEscolha(estado, carta)) {
      previsao.opcoes[opcao.chave] = simularJogada(estado, carta, opcao.escolha);
    }
    previsoes[carta.uid] = previsao;
  }
  return previsoes;
}

// O que cada jogador PODE ver. Nunca mandamos a mao de um jogador para os outros -
// e por isso que esta funcao existe.
function estadoVisivelPara(estado, jogadorId, espectador = false) {
  const eu = espectador ? null : jogadorPor(estado, jogadorId);
  return {
    espectador,
    // Espectador nao recebe previsao nenhuma: previsao so existe para quem joga.
    previsoes: eu ? preverJogadas(estado, eu) : {},
    turno: {
      limiteMs: LIMITE_DO_TURNO_MS,
      restanteMs: Math.max(0, LIMITE_DO_TURNO_MS - (Date.now() - (estado.turnoIniciadoEm || 0))),
    },
    fase: estado.fase,
    vezDe: estado.jogadores[estado.vezDe]?.id ?? null,
    souEu: jogadorId,
    fila: estado.fila,
    bar: estado.bar,
    ralo: estado.ralo,
    quadros: estado.quadros || [],
    jogadas: estado.jogadas,
    log: estado.log.slice(-14),
    placar: placar(estado),
    vencedores: estado.vencedores,
    resultado: estado.resultado || null,
    jogadores: estado.jogadores.map((j) => ({
      id: j.id,
      nome: j.nome,
      cor: j.cor,
      cartasNaMao: j.mao.length,
      cartasNoBaralho: j.baralho.length,
      mao: j.id === jogadorId ? j.mao : undefined, // so o dono ve a propria mao
    })),
  };
}

module.exports = {
  criarEstado,
  calcularResultado,
  jogadaAleatoria,
  opcoesDeEscolha,
  LIMITE_DO_TURNO_MS,
  jogarCarta,
  estadoVisivelPara,
  placar,
  calcularVencedores,
  escolhaNecessaria,
  acabou,
};
