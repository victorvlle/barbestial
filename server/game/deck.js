// Baralho de cada jogador: 12 animais identicos, so muda o dono (a cor).

const { ANIMAIS, REGRAS } = require('./cards');

// Cada carta em jogo e um objeto unico. O uid identifica a carta sem ambiguidade
// (o mesmo animal existe em 4 cores diferentes na mesa).
function criarBaralho(donoId) {
  return ANIMAIS.map((animal) => ({
    uid: `${donoId}:${animal.id}`,
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
function prepararJogador(jogador, aleatorio = Math.random) {
  const baralho = embaralhar(criarBaralho(jogador.id), aleatorio);
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
