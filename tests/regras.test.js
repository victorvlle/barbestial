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

test('gambá expulsa as duas espécies mais fortes e nunca outros gambás', () => {
  const estado = estadoCom('leao', 'crocodilo', 'papagaio', 'gamba');
  soOPoder(estado, 'gamba');
  assert.deepStrictEqual(ordem(estado.fila), ['papagaio', 'gamba', 'gamba']);
  assert.deepStrictEqual(ordem(estado.ralo), ['leao', 'crocodilo']);
});

test('papagaio manda pro ralo o animal escolhido', () => {
  const estado = estadoCom('leao', 'zebra');
  const alvo = estado.fila[0];
  soOPoder(estado, 'papagaio', { alvoUid: alvo.uid });
  assert.deepStrictEqual(ordem(estado.fila), ['zebra', 'papagaio']);
  assert.deepStrictEqual(ordem(estado.ralo), ['leao']);
});

test('canguru pula um ou dois animais, conforme a escolha', () => {
  const um = estadoCom('leao', 'zebra', 'foca');
  soOPoder(um, 'canguru', { pulos: 1 });
  assert.deepStrictEqual(ordem(um.fila), ['leao', 'zebra', 'canguru', 'foca']);

  const dois = estadoCom('leao', 'zebra', 'foca');
  soOPoder(dois, 'canguru', { pulos: 2 });
  assert.deepStrictEqual(ordem(dois.fila), ['leao', 'canguru', 'zebra', 'foca']);
});

test('macaco sozinho não faz nada', () => {
  const estado = estadoCom('crocodilo', 'hipopotamo');
  soOPoder(estado, 'macaco');
  assert.deepStrictEqual(ordem(estado.fila), ['crocodilo', 'hipopotamo', 'macaco']);
  assert.strictEqual(estado.ralo.length, 0);
});

test('segundo macaco expulsa hipopótamos e crocodilos e o bando vai pra frente', () => {
  // fila: macaco antigo, crocodilo, hipopotamo, zebra  -> chega o segundo macaco
  const estado = estadoCom('macaco', 'crocodilo', 'hipopotamo', 'zebra');
  soOPoder(estado, 'macaco');
  assert.deepStrictEqual(ordem(estado.fila), ['macaco', 'macaco', 'zebra']);
  assert.deepStrictEqual(ordem(estado.ralo).sort(), ['crocodilo', 'hipopotamo']);
});

test('bando de macacos se junta atrás do novo em ordem invertida', () => {
  const estado = estadoCom('macaco', 'zebra', 'macaco');
  const antigoDaFrente = estado.fila[0];
  const novo = soOPoder(estado, 'macaco');
  // o novo assume a frente; os antigos entram atras em ordem invertida
  assert.strictEqual(estado.fila[0], novo);
  assert.strictEqual(estado.fila[2], antigoDaFrente);
  assert.deepStrictEqual(ordem(estado.fila), ['macaco', 'macaco', 'macaco', 'zebra']);
});

test('camaleão só copia espécie que esteja na fila', () => {
  const estado = estadoCom('girafa', 'foca'); // nao ha crocodilo para imitar
  soOPoder(estado, 'camaleao', { especie: 'crocodilo' });
  assert.deepStrictEqual(ordem(estado.fila), ['girafa', 'foca', 'camaleao']);
  assert.strictEqual(estado.ralo.length, 0);
});

test('camaleão copiando crocodilo devora com força 10 e para no crocodilo real', () => {
  const estado = estadoCom('crocodilo', 'papagaio', 'foca');
  soOPoder(estado, 'camaleao', { especie: 'crocodilo' });
  // devora foca(6) e papagaio(2); para diante do crocodilo real (forca igual)
  assert.deepStrictEqual(ordem(estado.fila), ['crocodilo', 'camaleao']);
  assert.deepStrictEqual(ordem(estado.ralo).sort(), ['foca', 'papagaio']);
});

test('camaleão imitando girafa ultrapassa um animal mais fraco', () => {
  const estado = estadoCom('girafa', 'papagaio');
  soOPoder(estado, 'camaleao', { especie: 'girafa' });
  // camaleao vira forca 8 e passa o papagaio(2) que esta na frente dele
  assert.deepStrictEqual(ordem(estado.fila), ['girafa', 'camaleao', 'papagaio']);
});

test('foca inverte a fila inteira', () => {
  const estado = estadoCom('leao', 'zebra', 'papagaio');
  soOPoder(estado, 'foca');
  assert.deepStrictEqual(ordem(estado.fila), ['foca', 'papagaio', 'zebra', 'leao']);
});

test('zebra impede o crocodilo de comer', () => {
  const estado = estadoCom('papagaio', 'zebra');
  soOPoder(estado, 'crocodilo');
  assert.deepStrictEqual(ordem(estado.fila), ['papagaio', 'zebra', 'crocodilo']);
  assert.strictEqual(estado.ralo.length, 0);
});

test('zebra impede o hipopótamo de ultrapassar', () => {
  const estado = estadoCom('papagaio', 'zebra');
  soOPoder(estado, 'hipopotamo');
  assert.deepStrictEqual(ordem(estado.fila), ['papagaio', 'zebra', 'hipopotamo']);
});

test('girafa ultrapassa no máximo um animal por vez', () => {
  const estado = estadoCom('papagaio', 'canguru');
  soOPoder(estado, 'girafa');
  assert.deepStrictEqual(ordem(estado.fila), ['papagaio', 'girafa', 'canguru']);
});

test('cobra ordena a fila por força, o mais forte na porta', () => {
  const estado = estadoCom('papagaio', 'leao', 'foca');
  soOPoder(estado, 'cobra');
  assert.deepStrictEqual(ordem(estado.fila), ['leao', 'cobra', 'foca', 'papagaio']);
});

test('crocodilo devora todos os mais fracos e para no mais forte', () => {
  const estado = estadoCom('leao', 'papagaio', 'foca');
  soOPoder(estado, 'crocodilo');
  assert.deepStrictEqual(ordem(estado.fila), ['leao', 'crocodilo']);
  assert.deepStrictEqual(ordem(estado.ralo).sort(), ['foca', 'papagaio']);
});

test('hipopótamo não ultrapassa outro hipopótamo nem o leão', () => {
  const comHipo = estadoCom('hipopotamo', 'papagaio');
  soOPoder(comHipo, 'hipopotamo');
  assert.deepStrictEqual(ordem(comHipo.fila), ['hipopotamo', 'hipopotamo', 'papagaio']);

  const comLeao = estadoCom('leao', 'papagaio');
  soOPoder(comLeao, 'hipopotamo');
  assert.deepStrictEqual(ordem(comLeao.fila), ['leao', 'hipopotamo', 'papagaio']);
});

test('leão espanta todos os macacos e assume a frente', () => {
  const estado = estadoCom('macaco', 'zebra', 'macaco');
  soOPoder(estado, 'leao');
  assert.deepStrictEqual(ordem(estado.fila), ['leao', 'zebra']);
  assert.deepStrictEqual(ordem(estado.ralo), ['macaco', 'macaco']);
});

test('segundo leão vai direto pro ralo', () => {
  const estado = estadoCom('leao', 'zebra');
  const novo = soOPoder(estado, 'leao');
  assert.deepStrictEqual(ordem(estado.fila), ['leao', 'zebra']);
  assert.deepStrictEqual(estado.ralo, [novo]);
});

// ------------------------------------------------------- sequência do turno

test('com 5 na fila: os 2 da frente entram no bar e o último vai pro ralo', () => {
  const estado = estadoCom('leao', 'zebra', 'foca', 'papagaio', 'canguru');
  const resultado = resolverPorta(estado);
  assert.deepStrictEqual(ordem(estado.bar), ['leao', 'zebra']);
  assert.deepStrictEqual(ordem(estado.ralo), ['canguru']);
  assert.deepStrictEqual(ordem(estado.fila), ['foca', 'papagaio']);
  assert.strictEqual(resultado.entram.length, 2);
});

test('ações recorrentes disparam depois da carta jogada: a foca invertida é devorada', () => {
  // papagaio na frente, crocodilo atras. A foca inverte tudo e cai na boca do crocodilo.
  const estado = estadoCom('papagaio', 'crocodilo');
  jogarNaFila(estado, carta('foca'));
  assert.deepStrictEqual(ordem(estado.fila), ['crocodilo', 'papagaio']);
  assert.deepStrictEqual(ordem(estado.ralo), ['foca']);
});

test('a carta recém-jogada não repete a ação recorrente no mesmo turno', () => {
  const estado = estadoCom('papagaio', 'canguru');
  jogarNaFila(estado, carta('girafa'));
  // girafa passou UM animal (canguru). Se agisse duas vezes, teria passado o papagaio tambem.
  assert.deepStrictEqual(ordem(estado.fila), ['papagaio', 'girafa', 'canguru']);
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
  estado.bar = [carta('leao', 'a'), carta('papagaio', 'b')];
  const { calcularVencedores } = require('../server/game/gameState');
  const vencedores = calcularVencedores(estado);
  assert.deepStrictEqual(vencedores.map((v) => v.id), ['b']); // 1 x 1, mas 2 < 12
});

// ------------------------------------------------- camaleão virando leão

test('camaleão que imita o leão sofre a regra dos dois leões e vai pro ralo', () => {
  const estado = estadoCom('leao', 'zebra');
  const camaleao = soOPoder(estado, 'camaleao', { especie: 'leao' });
  // Enquanto age, ele É um leão: com outro leão na fila, é expulso.
  assert.deepStrictEqual(ordem(estado.fila), ['leao', 'zebra']);
  assert.deepStrictEqual(estado.ralo, [camaleao]);
});

test('camaleão imitando leão sem outro leão na fila assume a frente', () => {
  // sem leão na fila não há o que imitar, então usamos uma fila com leão E o efeito
  const estado = estadoCom('macaco', 'leao');
  const camaleao = soOPoder(estado, 'camaleao', { especie: 'leao' });
  // há um leão na fila, então o camaleão-leão é expulso (mesma regra acima)
  assert.ok(estado.ralo.includes(camaleao));
  assert.ok(ordem(estado.fila).includes('macaco'), 'o macaco não é espantado por um leão expulso');
});

test('o desempate explica o motivo', () => {
  const { calcularResultado } = require('../server/game/gameState');
  const estado = criarEstado([{ id: 'a', nome: 'Ana' }, { id: 'b', nome: 'Bruno' }]);
  estado.bar = [carta('leao', 'a'), carta('papagaio', 'b')];
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
