// Baralho de cada jogador: 12 animais identicos, so muda o dono (a cor).

const { ANIMAIS, REGRAS } = require('./cards');

// Cada carta em jogo e um objeto unico. O uid identifica a carta sem ambiguidade
// (o mesmo animal existe em 4 cores diferentes na mesa).
//
// O id da PARTIDA entra no uid de proposito: sem ele, o leao do jogador X teria
// o mesmo uid em todas as partidas, e o navegador - que reaproveita o elemento
// da carta pelo uid para poder animar - acabaria reusando a carta da partida
// anterior, com a cor antiga do jogador.
function criarBaralho(donoId, partidaId) {
  return ANIMAIS.map((animal) => ({
    uid: `${partidaId}:${donoId}:${animal.id}`,
    animal: animal.id,
    dono: donoId,
  }));
}

// Fisher-Yates. O parametro aleatorio existe para os testes poderem embaralhar
// de forma previsivel - sem isso nao da para testar nada que envolva sorteio.
function embaralhar(cartas, aleatorio = Math.random) {
  const copia = [...cartas];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(aleatorio() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

// Baralho embaralhado + as 4 primeiras cartas na mao.
function prepararJogador(jogador, aleatorio = Math.random, partidaId = 'p') {
  const baralho = embaralhar(criarBaralho(jogador.id, partidaId), aleatorio);
  return {
    ...jogador,
    mao: baralho.slice(0, REGRAS.CARTAS_NA_MAO),
    baralho: baralho.slice(REGRAS.CARTAS_NA_MAO),
  };
}

// Compra uma carta. Se o baralho acabou, simplesmente nao compra (regra oficial).
function comprar(jogador) {
  if (jogador.baralho.length > 0) {
    jogador.mao.push(jogador.baralho.shift());
  }
}

module.exports = { criarBaralho, embaralhar, prepararJogador, comprar };
