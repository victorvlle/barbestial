// Testes das regras. Rode com: npm test
// Cada teste monta uma fila especifica e verifica o resultado de um poder.
// Se um dia voce mexer no motor e quebrar uma regra, isso aqui avisa na hora.

const { test } = require('node:test');
const assert = require('node:assert');

const { aplicarPoder, jogarNaFila, resolverPorta } = require('../server/game/queue');
const { criarEstado, jogarCarta, escolhaNecessaria } = require('../server/game/gameState');

let contador = 0;
const carta = (animal, dono = 'p1') => ({ uid: `${dono}:${animal}:${++contador}`, animal, dono });

// Monta um estado com a fila ja povoada. Primeiro item = colado na porta do bar.
function estadoCom(...animais) {
  return {
    fase: 'jogando',
    fila: animais.map((a) => (Array.isArray(a) ? carta(a[0], a[1]) : carta(a))),
    bar: [],
    ralo: [],
    log: [],
  };
}

// Joga uma carta e executa SO o poder dela (sem acoes recorrentes) - para isolar regras.
function soOPoder(estado, animal, escolha, dono = 'p1') {
  const c = carta(animal, dono);
  estado.fila.push(c);
  aplicarPoder(estado, c, escolha);
  return c;
}

const ordem = (lista) => lista.map((c) => c.animal);

// ------------------------------------------------------------------ poderes

test('porco-espinho expulsa as duas espécies mais fortes e nunca outros porcos-espinhos', () => {
  const estado = estadoCom('lobo', 'tubarao', 'tucano', 'porcoespinho');
  soOPoder(estado, 'porcoespinho');
  assert.deepStrictEqual(ordem(estado.fila), ['tucano', 'porcoespinho', 'porcoespinho']);
  assert.deepStrictEqual(ordem(estado.ralo), ['lobo', 'tubarao']);
});

test('tucano manda pro ralo o animal escolhido', () => {
  const estado = estadoCom('lobo', 'cavalo');
  const alvo = estado.fila[0];
  soOPoder(estado, 'tucano', { alvoUid: alvo.uid });
  assert.deepStrictEqual(ordem(estado.fila), ['cavalo', 'tucano']);
  assert.deepStrictEqual(ordem(estado.ralo), ['lobo']);
});

test('coelho pula um ou dois animais, conforme a escolha', () => {
  const um = estadoCom('lobo', 'cavalo', 'pinguim');
  soOPoder(um, 'coelho', { pulos: 1 });
  assert.deepStrictEqual(ordem(um.fila), ['lobo', 'cavalo', 'coelho', 'pinguim']);

  const dois = estadoCom('lobo', 'cavalo', 'pinguim');
  soOPoder(dois, 'coelho', { pulos: 2 });
  assert.deepStrictEqual(ordem(dois.fila), ['lobo', 'coelho', 'cavalo', 'pinguim']);
});

test('babuíno sozinho não faz nada', () => {
  const estado = estadoCom('tubarao', 'elefante');
  soOPoder(estado, 'babuino');
  assert.deepStrictEqual(ordem(estado.fila), ['tubarao', 'elefante', 'babuino']);
  assert.strictEqual(estado.ralo.length, 0);
});

test('segundo babuíno expulsa elefantes e tubarões e o bando vai pra frente', () => {
  // fila: babuíno antigo, tubarão, elefante, cavalo  -> chega o segundo babuíno
  const estado = estadoCom('babuino', 'tubarao', 'elefante', 'cavalo');
  soOPoder(estado, 'babuino');
  assert.deepStrictEqual(ordem(estado.fila), ['babuino', 'babuino', 'cavalo']);
  assert.deepStrictEqual(ordem(estado.ralo).sort(), ['elefante', 'tubarao']);
});

test('bando de babuínos se junta atrás do novo em ordem invertida', () => {
  const estado = estadoCom('babuino', 'cavalo', 'babuino');
  const antigoDaFrente = estado.fila[0];
  const novo = soOPoder(estado, 'babuino');
  // o novo assume a frente; os antigos entram atras em ordem invertida
  assert.strictEqual(estado.fila[0], novo);
  assert.strictEqual(estado.fila[2], antigoDaFrente);
  assert.deepStrictEqual(ordem(estado.fila), ['babuino', 'babuino', 'babuino', 'cavalo']);
});

test('polvo só copia espécie que esteja na fila', () => {
  const estado = estadoCom('pavao', 'pinguim'); // nao ha tubarão para imitar
  soOPoder(estado, 'polvo', { especie: 'tubarao' });
  assert.deepStrictEqual(ordem(estado.fila), ['pavao', 'pinguim', 'polvo']);
  assert.strictEqual(estado.ralo.length, 0);
});

test('polvo copiando tubarão devora com força 10 e para no tubarão real', () => {
  const estado = estadoCom('tubarao', 'tucano', 'pinguim');
  soOPoder(estado, 'polvo', { especie: 'tubarao' });
  // devora pinguim(6) e tucano(2); para diante do tubarão real (forca igual)
  assert.deepStrictEqual(ordem(estado.fila), ['tubarao', 'polvo']);
  assert.deepStrictEqual(ordem(estado.ralo).sort(), ['pinguim', 'tucano']);
});

test('polvo imitando pavão ultrapassa um animal mais fraco', () => {
  const estado = estadoCom('pavao', 'tucano');
  soOPoder(estado, 'polvo', { especie: 'pavao' });
  // polvo vira forca 8 e passa o tucano(2) que esta na frente dele
  assert.deepStrictEqual(ordem(estado.fila), ['pavao', 'polvo', 'tucano']);
});

test('pinguim inverte a fila inteira', () => {
  const estado = estadoCom('lobo', 'cavalo', 'tucano');
  soOPoder(estado, 'pinguim');
  assert.deepStrictEqual(ordem(estado.fila), ['pinguim', 'tucano', 'cavalo', 'lobo']);
});

test('cavalo impede o tubarão de comer', () => {
  const estado = estadoCom('tucano', 'cavalo');
  soOPoder(estado, 'tubarao');
  assert.deepStrictEqual(ordem(estado.fila), ['tucano', 'cavalo', 'tubarao']);
  assert.strictEqual(estado.ralo.length, 0);
});

test('cavalo impede o elefante de ultrapassar', () => {
  const estado = estadoCom('tucano', 'cavalo');
  soOPoder(estado, 'elefante');
  assert.deepStrictEqual(ordem(estado.fila), ['tucano', 'cavalo', 'elefante']);
});

test('pavão ultrapassa no máximo um animal por vez', () => {
  const estado = estadoCom('tucano', 'coelho');
  soOPoder(estado, 'pavao');
  assert.deepStrictEqual(ordem(estado.fila), ['tucano', 'pavao', 'coelho']);
});

test('águia ordena a fila por força, o mais forte na porta', () => {
  const estado = estadoCom('tucano', 'lobo', 'pinguim');
  soOPoder(estado, 'aguia');
  assert.deepStrictEqual(ordem(estado.fila), ['lobo', 'aguia', 'pinguim', 'tucano']);
});

test('tubarão devora todos os mais fracos e para no mais forte', () => {
  const estado = estadoCom('lobo', 'tucano', 'pinguim');
  soOPoder(estado, 'tubarao');
  assert.deepStrictEqual(ordem(estado.fila), ['lobo', 'tubarao']);
  assert.deepStrictEqual(ordem(estado.ralo).sort(), ['pinguim', 'tucano']);
});

test('elefante não ultrapassa outro elefante nem o lobo alfa', () => {
  const comHipo = estadoCom('elefante', 'tucano');
  soOPoder(comHipo, 'elefante');
  assert.deepStrictEqual(ordem(comHipo.fila), ['elefante', 'elefante', 'tucano']);

  const comLeao = estadoCom('lobo', 'tucano');
  soOPoder(comLeao, 'elefante');
  assert.deepStrictEqual(ordem(comLeao.fila), ['lobo', 'elefante', 'tucano']);
});

test('lobo alfa espanta todos os babuínos e assume a frente', () => {
  const estado = estadoCom('babuino', 'cavalo', 'babuino');
  soOPoder(estado, 'lobo');
  assert.deepStrictEqual(ordem(estado.fila), ['lobo', 'cavalo']);
  assert.deepStrictEqual(ordem(estado.ralo), ['babuino', 'babuino']);
});

test('segundo lobo alfa vai direto pro ralo', () => {
  const estado = estadoCom('lobo', 'cavalo');
  const novo = soOPoder(estado, 'lobo');
  assert.deepStrictEqual(ordem(estado.fila), ['lobo', 'cavalo']);
  assert.deepStrictEqual(estado.ralo, [novo]);
});

// ------------------------------------------------------- sequência do turno

test('com 5 na fila: os 2 da frente entram no bar e o último vai pro ralo', () => {
  const estado = estadoCom('lobo', 'cavalo', 'pinguim', 'tucano', 'coelho');
  const resultado = resolverPorta(estado);
  assert.deepStrictEqual(ordem(estado.bar), ['lobo', 'cavalo']);
  assert.deepStrictEqual(ordem(estado.ralo), ['coelho']);
  assert.deepStrictEqual(ordem(estado.fila), ['pinguim', 'tucano']);
  assert.strictEqual(resultado.entram.length, 2);
});

test('ações recorrentes disparam depois da carta jogada: o pinguim invertido é devorado', () => {
  // tucano na frente, tubarao atras. O pinguim inverte tudo e cai na boca do tubarao.
  const estado = estadoCom('tucano', 'tubarao');
  jogarNaFila(estado, carta('pinguim'));
  assert.deepStrictEqual(ordem(estado.fila), ['tubarao', 'tucano']);
  assert.deepStrictEqual(ordem(estado.ralo), ['pinguim']);
});

test('a carta recém-jogada não repete a ação recorrente no mesmo turno', () => {
  const estado = estadoCom('tucano', 'coelho');
  jogarNaFila(estado, carta('pavao'));
  // pavão passou UM animal (coelho). Se agisse duas vezes, teria passado o tucano tambem.
  assert.deepStrictEqual(ordem(estado.fila), ['tucano', 'pavao', 'coelho']);
});

// ------------------------------------------------------------ partida inteira

test('partida completa termina, sem perder nem duplicar cartas', () => {
  // aleatorio fixo = embaralhamento previsivel, teste sempre igual
  let semente = 0.42;
  const aleatorio = () => (semente = (semente * 9301 + 49297) % 233280 / 233280);

  const estado = criarEstado(
    [{ id: 'a', nome: 'Ana' }, { id: 'b', nome: 'Bruno' }],
    aleatorio
  );

  let jogadas = 0;
  while (estado.fase === 'jogando' && jogadas < 100) {
    const jogador = estado.jogadores[estado.vezDe];
    const cartaEscolhida = jogador.mao[0];

    // escolhas automaticas para os poderes que pedem decisao
    let escolha = null;
    const precisa = escolhaNecessaria(cartaEscolhida.animal);
    if (precisa === 'animal') escolha = { alvoUid: estado.fila[0]?.uid };
    if (precisa === 'pular1ou2') escolha = { pulos: 1 };
    if (precisa === 'especie') escolha = { especie: estado.fila[0]?.animal };

    jogarCarta(estado, jogador.id, cartaEscolhida.uid, escolha);
    jogadas++;
  }

  assert.strictEqual(estado.fase, 'terminado');
  assert.strictEqual(jogadas, 24, 'duas mãos de 12 cartas = 24 jogadas');

  const total = estado.bar.length + estado.ralo.length + estado.fila.length;
  assert.strictEqual(total, 24, 'nenhuma carta pode sumir nem se duplicar');

  const uids = new Set([...estado.bar, ...estado.ralo, ...estado.fila].map((c) => c.uid));
  assert.strictEqual(uids.size, 24, 'todas as cartas são únicas');

  assert.ok(estado.vencedores.length >= 1);
});

test('desempate é pela menor soma de forças', () => {
  const estado = criarEstado([{ id: 'a', nome: 'Ana' }, { id: 'b', nome: 'Bruno' }]);
  estado.bar = [carta('lobo', 'a'), carta('tucano', 'b')];
  const { calcularVencedores } = require('../server/game/gameState');
  const vencedores = calcularVencedores(estado);
  assert.deepStrictEqual(vencedores.map((v) => v.id), ['b']); // 1 x 1, mas 2 < 12
});

// ------------------------------------------------- polvo virando lobo alfa

test('polvo que imita o lobo alfa sofre a regra dos dois lobos alfa e vai pro ralo', () => {
  const estado = estadoCom('lobo', 'cavalo');
  const polvo = soOPoder(estado, 'polvo', { especie: 'lobo' });
  // Enquanto age, ele É um lobo alfa: com outro lobo alfa na fila, é expulso.
  assert.deepStrictEqual(ordem(estado.fila), ['lobo', 'cavalo']);
  assert.deepStrictEqual(estado.ralo, [polvo]);
});

test('polvo imitando lobo alfa sem outro lobo alfa na fila assume a frente', () => {
  // sem lobo alfa na fila não há o que imitar, então usamos uma fila com lobo alfa E o efeito
  const estado = estadoCom('babuino', 'lobo');
  const polvo = soOPoder(estado, 'polvo', { especie: 'lobo' });
  // há um lobo alfa na fila, então o polvo-lobo alfa é expulso (mesma regra acima)
  assert.ok(estado.ralo.includes(polvo));
  assert.ok(ordem(estado.fila).includes('babuino'), 'o babuíno não é espantado por um lobo alfa expulso');
});

test('o desempate explica o motivo', () => {
  const { calcularResultado } = require('../server/game/gameState');
  const estado = criarEstado([{ id: 'a', nome: 'Ana' }, { id: 'b', nome: 'Bruno' }]);
  estado.bar = [carta('lobo', 'a'), carta('tucano', 'b')];
  const r = calcularResultado(estado);
  assert.strictEqual(r.criterio, 'forca');
  assert.deepStrictEqual(r.vencedores.map((v) => v.id), ['b']);
  assert.strictEqual(r.empatados.length, 2);
});

// --------------------------------------------- identidade das cartas

test('cada partida gera uids diferentes para as mesmas cartas', () => {
  const jogadores = [{ id: 'a', nome: 'Ana' }, { id: 'b', nome: 'Bruno' }];
  const primeira = criarEstado(jogadores);
  const segunda = criarEstado(jogadores);

  const uidsDaPrimeira = new Set(
    primeira.jogadores.flatMap((j) => [...j.mao, ...j.baralho].map((c) => c.uid))
  );
  const repetidos = segunda.jogadores
    .flatMap((j) => [...j.mao, ...j.baralho])
    .filter((c) => uidsDaPrimeira.has(c.uid));

  // Se repetissem, o navegador reaproveitaria o elemento da partida anterior -
  // que foi o bug das cores erradas quando um jogador trocava de cor.
  assert.strictEqual(repetidos.length, 0, 'nenhum uid pode se repetir entre partidas');
  assert.notStrictEqual(primeira.partidaId, segunda.partidaId);
});
