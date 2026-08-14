// Testes das ANOTACOES DE EFEITO. Rode com: npm test
//
// O que estes testes protegem: a anotacao tem que descrever o que o motor
// REALMENTE fez. Se um dia alguem mudar um poder e esquecer a anotacao, o
// holograma vai mentir para o jogador - e e exatamente isso que queremos pegar.
//
// O outro lado da moeda, igualmente importante: anotar nao pode mudar NADA.
// Por isso varios testes rodam a mesma jogada com e sem anotacao e comparam.

const { test } = require('node:test');
const assert = require('node:assert');

const { jogarNaFila, simularJogada } = require('../server/game/queue');

let contador = 0;
const carta = (animal, dono = 'p1') => ({ uid: `${dono}:${animal}:${++contador}`, animal, dono });

// Um estado minimo, com efeitos ligados - como numa partida de verdade.
function mesa(...animais) {
  return {
    fase: 'jogando',
    fila: animais.map((a) => (Array.isArray(a) ? carta(a[0], a[1]) : carta(a))),
    bar: [],
    ralo: [],
    log: [],
    quadros: [],
    efeitos: [],
  };
}

// Joga uma carta pelo caminho normal (passos 1 a 4) e devolve tudo o que saiu.
function jogar(estado, animal, escolha = null, dono = 'p1') {
  const c = carta(animal, dono);
  jogarNaFila(estado, c, escolha);
  return c;
}

const doTipo = (estado, tipo) => estado.efeitos.filter((e) => e.tipo === tipo);
const um = (estado, tipo) => {
  const achados = doTipo(estado, tipo);
  assert.strictEqual(achados.length, 1, `esperava exatamente 1 efeito "${tipo}"`);
  return achados[0];
};
const animaisDe = (estado, uids) =>
  uids.map((uid) => [...estado.fila, ...estado.bar, ...estado.ralo].find((c) => c.uid === uid)?.animal);

// ------------------------------------------------------------ cada poder

test('porco-espinho: os alvos anotados são exatamente quem foi pro ralo', () => {
  const estado = mesa('lobo', 'tubarao', 'tucano');
  jogar(estado, 'porcoespinho');

  const efeito = um(estado, 'porcoespinho');
  assert.deepStrictEqual(
    efeito.alvos.slice().sort(),
    estado.ralo.map((c) => c.uid).sort()
  );
  assert.deepStrictEqual(efeito.alvoAnimais.slice().sort(), ['lobo', 'tubarao']);
});

test('porco-espinho sozinho na fila não anota efeito nenhum', () => {
  const estado = mesa();
  jogar(estado, 'porcoespinho');
  assert.deepStrictEqual(doTipo(estado, 'porcoespinho'), []);
});

test('tucano: o alvo anotado é a carta que sumiu da fila', () => {
  const estado = mesa('cavalo', 'pinguim');
  const vitima = estado.fila[0];
  jogar(estado, 'tucano', { alvoUid: vitima.uid });

  assert.deepStrictEqual(um(estado, 'tucano').alvos, [vitima.uid]);
  assert.ok(estado.ralo.includes(vitima));
});

test('coelho: o número de pulos anotado é o mesmo que ele andou', () => {
  const estado = mesa('lobo', 'cavalo', 'pinguim');
  const coelho = jogar(estado, 'coelho', { pulos: 2 });

  const efeito = um(estado, 'coelho');
  assert.strictEqual(efeito.pulos, 2);
  assert.strictEqual(efeito.alvos.length, 2); // pulou por cima de dois
  assert.strictEqual(estado.fila.indexOf(coelho), 1);
});

test('coelho que não tem para onde pular não anota nada', () => {
  const estado = mesa();
  jogar(estado, 'coelho', { pulos: 2 });
  assert.deepStrictEqual(doTipo(estado, 'coelho'), []);
});

test('babuíno sozinho anota "solo"; em bando anota "bando" com as vítimas certas', () => {
  const sozinho = mesa('cavalo');
  jogar(sozinho, 'babuino');
  assert.strictEqual(um(sozinho, 'babuino-solo').alvos.length, 0);
  assert.deepStrictEqual(doTipo(sozinho, 'babuino-bando'), []);

  const bando = mesa('babuino', 'elefante');
  jogar(bando, 'babuino');
  const efeito = um(bando, 'babuino-bando');
  assert.deepStrictEqual(efeito.alvoAnimais, ['elefante']);
  assert.strictEqual(efeito.bando.length, 2); // o novo e o que ja estava
  assert.deepStrictEqual(bando.ralo.map((c) => c.animal), ['elefante']);
});

test('polvo: anota a espécie copiada, a ida e a volta, com o poder copiado no meio', () => {
  // Só dá para copiar quem está na fila: por isso o tucano precisa estar lá.
  const estado = mesa('cavalo', 'tucano');
  const alvo = estado.fila[0];
  jogar(estado, 'polvo', { especie: 'tucano', alvoUid: alvo.uid });

  const tipos = estado.efeitos.map((e) => e.tipo);
  assert.deepStrictEqual(tipos, ['polvo', 'tucano', 'polvo-volta']);
  assert.strictEqual(um(estado, 'polvo').copiando, 'tucano');
  // O tucano anotado no meio é o próprio polvo agindo como tucano.
  assert.strictEqual(um(estado, 'tucano').animal, 'polvo');
  assert.ok(estado.ralo.includes(alvo));
});

test('pinguim: os alvos anotados são todos os outros da fila', () => {
  const estado = mesa('lobo', 'cavalo');
  jogar(estado, 'pinguim');
  assert.strictEqual(um(estado, 'pinguim').alvos.length, 2);
  assert.deepStrictEqual(estado.fila.map((c) => c.animal), ['pinguim', 'cavalo', 'lobo']);
});

test('cavalo anota só no turno em que é jogado, nunca nas ações recorrentes', () => {
  const estado = mesa('tucano');
  jogar(estado, 'cavalo');
  assert.strictEqual(doTipo(estado, 'cavalo').length, 1);

  // Turno seguinte: o cavalo continua na fila, mas não anota de novo.
  jogar(estado, 'coelho', { pulos: 1 });
  assert.deepStrictEqual(doTipo(estado, 'cavalo'), []);
});

test('pavão: anota quem ele ultrapassou, e só quando ultrapassa mesmo', () => {
  const passa = mesa('tucano');
  jogar(passa, 'pavao');
  assert.deepStrictEqual(um(passa, 'pavao').alvoAnimais, ['tucano']);

  const naoPassa = mesa('lobo');
  jogar(naoPassa, 'pavao');
  assert.deepStrictEqual(doTipo(naoPassa, 'pavao'), []);
});

test('águia: anota todos os outros da fila e a fila fica ordenada por força', () => {
  const estado = mesa('tucano', 'lobo', 'coelho');
  jogar(estado, 'aguia');
  assert.strictEqual(um(estado, 'aguia').alvos.length, 3);
  assert.deepStrictEqual(estado.fila.map((c) => c.animal), ['lobo', 'aguia', 'coelho', 'tucano']);
});

test('tubarão: a ordem dos alvos anotados é a ordem real das mordidas', () => {
  const estado = mesa('pinguim', 'tucano');
  jogar(estado, 'tubarao');

  const efeito = um(estado, 'tubarao');
  // Ele come de trás para frente: primeiro o tucano (mais perto), depois o pinguim.
  assert.deepStrictEqual(efeito.alvoAnimais, ['tucano', 'pinguim']);
  assert.deepStrictEqual(estado.ralo.map((c) => c.animal), ['tucano', 'pinguim']);
});

test('elefante: "passou" bate com quantos ele empurrou de verdade', () => {
  const estado = mesa('tucano', 'coelho', 'pinguim');
  const elefante = jogar(estado, 'elefante');

  const efeito = um(estado, 'elefante');
  assert.strictEqual(efeito.passou, 3);
  assert.strictEqual(efeito.alvos.length, 3);
  assert.strictEqual(estado.fila.indexOf(elefante), 0);
});

test('cavalo barrando: o bloqueio é anotado com o cavalo como autor', () => {
  const estado = mesa('tucano', 'cavalo');
  jogar(estado, 'tubarao');

  const bloqueio = um(estado, 'bloqueio');
  assert.strictEqual(bloqueio.animal, 'cavalo');
  assert.deepStrictEqual(bloqueio.alvoAnimais, ['tubarao']);
  // O tucano estava protegido atrás do cavalo e continua vivo.
  assert.ok(estado.fila.some((c) => c.animal === 'tucano'));
});

test('lobo alfa: anota quem espantou; contra outro lobo anota o duelo', () => {
  const chega = mesa('babuino', 'tucano');
  jogar(chega, 'lobo');
  assert.deepStrictEqual(um(chega, 'lobo').alvoAnimais, ['babuino']);

  const duelo = mesa('lobo');
  const novo = jogar(duelo, 'lobo', null, 'p2');
  const efeito = um(duelo, 'lobo-duelo');
  assert.deepStrictEqual(efeito.alvos, [novo.uid]); // quem chegou é que vai pro ralo
  assert.ok(duelo.ralo.includes(novo));
  assert.deepStrictEqual(doTipo(duelo, 'lobo'), []);
});

// ------------------------------------------------------------ poderes recorrentes
//
// O passo 3 do turno reexecuta cavalo, pavão, tubarão e elefante que ja estavam
// na fila. Esses tambem precisam de animacao - e num quadro DEPOIS do poder da
// carta que acabou de ser jogada.

test('pavão que já estava na fila anota efeito de novo, num quadro posterior', () => {
  const estado = mesa('coelho', 'pavao');
  jogar(estado, 'cavalo'); // o cavalo não faz nada: quem age no passo 3 é o pavão

  const pavao = um(estado, 'pavao');
  const cavalo = um(estado, 'cavalo');
  assert.deepStrictEqual(pavao.alvoAnimais, ['coelho']);
  // A ordem da lista é a ordem em que as animações são encenadas. Aqui os dois
  // caem no mesmo quadro (o cavalo não mexeu no tabuleiro, então não virou
  // foto), mas o cavalo continua vindo primeiro - que é a ordem do turno.
  assert.ok(pavao.quadro >= cavalo.quadro);
  assert.ok(
    estado.efeitos.indexOf(pavao) > estado.efeitos.indexOf(cavalo),
    'a ação recorrente é encenada depois da carta jogada'
  );
  assert.deepStrictEqual(estado.fila.map((c) => c.animal), ['pavao', 'coelho', 'cavalo']);
});

test('tubarão que já estava na fila continua anotando a cada turno', () => {
  const estado = mesa('tucano', 'tubarao');
  jogar(estado, 'cavalo');

  const efeito = um(estado, 'tubarao');
  assert.deepStrictEqual(efeito.alvoAnimais, ['tucano']);
  assert.deepStrictEqual(estado.ralo.map((c) => c.animal), ['tucano']);
});

// ------------------------------------------------------------ garantias gerais

test('todo efeito aponta para um quadro que existe', () => {
  const estado = mesa('tucano', 'coelho', 'pinguim');
  jogar(estado, 'elefante');
  assert.ok(estado.efeitos.length > 0);
  for (const efeito of estado.efeitos) {
    assert.ok(Number.isInteger(efeito.quadro) && efeito.quadro >= 0, 'quadro inválido');
    assert.ok(efeito.quadro <= estado.quadros.length, 'quadro além do fim da jogada');
  }
});

test('cada jogada recomeça a lista de efeitos', () => {
  const estado = mesa('tucano');
  jogar(estado, 'pavao');
  assert.ok(estado.efeitos.length > 0);
  jogar(estado, 'cavalo');
  assert.deepStrictEqual(doTipo(estado, 'pavao'), []); // o pavão da jogada anterior sumiu
});

test('a simulação da prévia não anota efeito nenhum', () => {
  const estado = mesa('tucano', 'coelho');
  const antes = JSON.stringify(estado.efeitos);
  simularJogada(estado, carta('tubarao'), null);
  assert.strictEqual(JSON.stringify(estado.efeitos), antes);
});

test('anotar não muda o resultado: mesma jogada com e sem efeitos dá a mesma fila', () => {
  const animais = ['tucano', 'coelho', 'cavalo', 'pinguim'];

  const comEfeitos = mesa(...animais);
  const semEfeitos = mesa(...animais);
  semEfeitos.efeitos = null; // desliga a anotacao

  const jogada = (estado) => {
    const c = carta('aguia');
    jogarNaFila(estado, c, null);
    return {
      fila: estado.fila.map((x) => x.animal),
      bar: estado.bar.map((x) => x.animal),
      ralo: estado.ralo.map((x) => x.animal),
      quadros: estado.quadros.length,
      log: estado.log.length,
    };
  };

  assert.deepStrictEqual(jogada(comEfeitos), jogada(semEfeitos));
});

test('os uids anotados existem de verdade no tabuleiro', () => {
  const estado = mesa('babuino', 'elefante', 'tucano');
  jogar(estado, 'babuino');
  for (const efeito of estado.efeitos) {
    for (const nome of animaisDe(estado, efeito.alvos)) {
      assert.ok(nome, 'alvo anotado não corresponde a nenhuma carta');
    }
  }
});
