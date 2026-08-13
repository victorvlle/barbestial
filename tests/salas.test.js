// Testes das salas: entrada, saida, reconexao e quem pode comecar a partida.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const sala = require('../server/game/room');

beforeEach(() => sala.salas.clear()); // cada teste comeca com o servidor limpo

const jogador = (id, nome) => ({ id, nome, socketId: `socket-${id}` });

test('criar sala gera um código de 4 caracteres e já coloca o criador dentro', () => {
  const s = sala.criarSala(jogador('a', 'Ana'));
  assert.match(s.codigo, /^[A-Z0-9]{4}$/);
  assert.strictEqual(s.jogadores.length, 1);
  assert.strictEqual(s.anfitriao, 'a');
  assert.strictEqual(s.jogadores[0].cor, 'vermelho');
});

test('cada jogador recebe uma cor diferente', () => {
  const s = sala.criarSala(jogador('a', 'Ana'));
  sala.entrarNaSala(s.codigo, jogador('b', 'Bruno'));
  sala.entrarNaSala(s.codigo, jogador('c', 'Caio'));
  assert.deepStrictEqual(s.jogadores.map((j) => j.cor), ['vermelho', 'azul', 'verde']);
});

test('código errado dá erro claro', () => {
  assert.throws(
    () => sala.entrarNaSala('ZZZZ', jogador('b', 'Bruno')),
    /Sala não encontrada/
  );
});

test('o código não diferencia maiúscula de minúscula', () => {
  const s = sala.criarSala(jogador('a', 'Ana'));
  const mesma = sala.entrarNaSala(s.codigo.toLowerCase(), jogador('b', 'Bruno'));
  assert.strictEqual(mesma.codigo, s.codigo);
});

test('entrar sem nome é recusado', () => {
  const s = sala.criarSala(jogador('a', 'Ana'));
  assert.throws(() => sala.entrarNaSala(s.codigo, { id: 'b', nome: '   ' }), /nome/);
});

test('a sala não aceita um quinto jogador', () => {
  const s = sala.criarSala(jogador('a', 'Ana'));
  sala.entrarNaSala(s.codigo, jogador('b', 'Bruno'));
  sala.entrarNaSala(s.codigo, jogador('c', 'Caio'));
  sala.entrarNaSala(s.codigo, jogador('d', 'Duda'));
  assert.throws(() => sala.entrarNaSala(s.codigo, jogador('e', 'Edu')), /4 jogadores/);
});

test('ninguém novo entra depois que a partida começou', () => {
  const s = sala.criarSala(jogador('a', 'Ana'));
  sala.entrarNaSala(s.codigo, jogador('b', 'Bruno'));
  sala.iniciarPartida(s.codigo, 'a');
  assert.throws(() => sala.entrarNaSala(s.codigo, jogador('c', 'Caio')), /já começou/);
});

test('quem já estava na sala consegue reconectar com outro socket', () => {
  const s = sala.criarSala(jogador('a', 'Ana'));
  sala.entrarNaSala(s.codigo, jogador('b', 'Bruno'));
  sala.iniciarPartida(s.codigo, 'a');

  sala.desconectar('socket-b');
  assert.strictEqual(s.jogadores.find((j) => j.id === 'b').conectado, false);
  assert.strictEqual(s.jogadores.length, 2, 'no meio da partida o jogador não é removido');

  sala.entrarNaSala(s.codigo, { id: 'b', nome: 'Bruno', socketId: 'socket-b-novo' });
  const bruno = s.jogadores.find((j) => j.id === 'b');
  assert.strictEqual(bruno.conectado, true);
  assert.strictEqual(bruno.socketId, 'socket-b-novo');
});

test('sair antes da partida remove o jogador da lista', () => {
  const s = sala.criarSala(jogador('a', 'Ana'));
  sala.entrarNaSala(s.codigo, jogador('b', 'Bruno'));
  sala.desconectar('socket-b');
  assert.deepStrictEqual(s.jogadores.map((j) => j.id), ['a']);
});

test('se o anfitrião sai antes de começar, outro assume', () => {
  const s = sala.criarSala(jogador('a', 'Ana'));
  sala.entrarNaSala(s.codigo, jogador('b', 'Bruno'));
  sala.desconectar('socket-a');
  assert.strictEqual(s.anfitriao, 'b');
});

test('sala sem ninguém conectado é apagada', () => {
  const s = sala.criarSala(jogador('a', 'Ana'));
  sala.desconectar('socket-a');
  assert.strictEqual(sala.salaPorCodigo(s.codigo), null);
});

test('só o anfitrião começa a partida', () => {
  const s = sala.criarSala(jogador('a', 'Ana'));
  sala.entrarNaSala(s.codigo, jogador('b', 'Bruno'));
  assert.throws(() => sala.iniciarPartida(s.codigo, 'b'), /Só quem criou/);
});

test('não dá para começar sozinho', () => {
  const s = sala.criarSala(jogador('a', 'Ana'));
  assert.throws(() => sala.iniciarPartida(s.codigo, 'a'), /pelo menos 2/);
});

test('ao começar, cada jogador recebe 4 cartas na mão e 8 no baralho', () => {
  const s = sala.criarSala(jogador('a', 'Ana'));
  sala.entrarNaSala(s.codigo, jogador('b', 'Bruno'));
  sala.iniciarPartida(s.codigo, 'a');
  for (const j of s.estado.jogadores) {
    assert.strictEqual(j.mao.length, 4);
    assert.strictEqual(j.baralho.length, 8);
  }
});

test('o resumo enviado ao lobby não vaza cartas nem socket', () => {
  const s = sala.criarSala(jogador('a', 'Ana'));
  sala.entrarNaSala(s.codigo, jogador('b', 'Bruno'));
  sala.iniciarPartida(s.codigo, 'a');
  const resumo = sala.resumoDaSala(s);
  const texto = JSON.stringify(resumo);
  assert.ok(!texto.includes('socket-'), 'não pode expor socketId');
  assert.ok(!texto.includes('mao'), 'não pode expor a mão de ninguém');
  assert.strictEqual(resumo.emPartida, true);
});

// ------------------------------------------------------------- revanche

function partidaTerminada() {
  const s = sala.criarSala(jogador('a', 'Ana'));
  sala.entrarNaSala(s.codigo, jogador('b', 'Bruno'));
  sala.iniciarPartida(s.codigo, 'a');
  s.estado.fase = 'terminado';
  return s;
}

test('a revanche só começa quando todos toparem', () => {
  const s = partidaTerminada();
  const primeiro = sala.votarRevanche(s.codigo, 'a', true);
  assert.strictEqual(primeiro.acao, 'aguardando', 'com um voto só, ainda espera');
  assert.strictEqual(sala.resumoDaSala(s).jogadores.find((j) => j.id === 'a').revanche, 'sim',
    'o voto fica visível para todos');

  const segundo = sala.votarRevanche(s.codigo, 'b', true);
  assert.strictEqual(segundo.acao, 'nova-partida');
  assert.strictEqual(s.estado.fase, 'jogando');
  assert.strictEqual(s.estado.jogadores[0].mao.length, 4, 'mãos novas');
  assert.strictEqual(s.estado.bar.length, 0, 'placar zerado');
});

test('um único "não" encerra a sala para todo mundo', () => {
  const s = partidaTerminada();
  sala.votarRevanche(s.codigo, 'a', true);
  const r = sala.votarRevanche(s.codigo, 'b', false);
  assert.strictEqual(r.acao, 'encerrada');
  assert.strictEqual(r.quemSaiu, 'b');
});

test('quem desconecta depois do fim da partida sai da sala', () => {
  const s = partidaTerminada();
  sala.desconectar('socket-b');
  assert.deepStrictEqual(s.jogadores.map((j) => j.id), ['a']);
});

test('revanche antes do fim da partida é recusada', () => {
  const s = sala.criarSala(jogador('a', 'Ana'));
  sala.entrarNaSala(s.codigo, jogador('b', 'Bruno'));
  sala.iniciarPartida(s.codigo, 'a');
  assert.throws(() => sala.votarRevanche(s.codigo, 'a', true), /depois que a partida acaba/);
});
