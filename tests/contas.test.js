// Testes de contas e ranking. Rode com: npm test
//
// Tudo roda num banco de memoria: nenhum arquivo e criado, nada do que ja
// existe no seu computador e tocado, e cada execucao comeca do zero.

process.env.BANCO_CAMINHO = ':memory:';
process.env.SESSAO_SEGREDO = 'segredo-so-de-teste';

const { test } = require('node:test');
const assert = require('node:assert');

const usuarios = require('../server/dados/usuarios');
const ranking = require('../server/dados/ranking');
const { criarEstado, jogarCarta, calcularResultado } = require('../server/game/gameState');

let contador = 0;
const conta = (nome) => usuarios.criarContaLocal(`${nome}${++contador}`, 'senha1234');

// ============================================================ 1. contas

test('cria uma conta e entra com ela', () => {
  const criada = usuarios.criarContaLocal('Victor', 'batatinha');
  assert.strictEqual(criada.nome, 'Victor');
  assert.strictEqual(criada.provedor, 'local');
  assert.ok(criada.id, 'a conta precisa de um identificador único');

  const entrou = usuarios.entrarComSenha('Victor', 'batatinha');
  assert.strictEqual(entrou.id, criada.id, 'entrar tem que achar a MESMA conta');
});

test('o apelido não diferencia maiúsculas, mas o nome exibido é preservado', () => {
  const criada = usuarios.criarContaLocal('Jorge', 'senha1234');
  assert.strictEqual(usuarios.entrarComSenha('JORGE', 'senha1234').id, criada.id);
  assert.strictEqual(criada.nome, 'Jorge');
});

test('a senha nunca é guardada em texto puro', () => {
  const criada = usuarios.criarContaLocal('Segredo', 'minhasenha');
  assert.ok(criada.senha_hash && criada.senha_hash !== 'minhasenha');
  assert.ok(criada.senha_sal, 'cada conta tem o próprio sal');

  // Duas contas com a MESMA senha têm hashes diferentes - é para isso que
  // serve o sal: uma tabela de senhas prontas não serve para nada.
  const outra = usuarios.criarContaLocal('Segredo2', 'minhasenha');
  assert.notStrictEqual(criada.senha_hash, outra.senha_hash);
});

// Roda a função e devolve o erro que ela lançou (ou null).
function oQueDeuErrado(acao) {
  try {
    acao();
    return null;
  } catch (erro) {
    return erro;
  }
}

test('senha errada não entra, e o erro não revela se a conta existe', () => {
  usuarios.criarContaLocal('Maria', 'certa1234');
  const erroSenha = oQueDeuErrado(() => usuarios.entrarComSenha('Maria', 'errada'));
  const erroConta = oQueDeuErrado(() => usuarios.entrarComSenha('NinguemAssim', 'errada'));

  assert.ok(erroSenha && erroConta, 'os dois casos precisam recusar');
  assert.strictEqual(
    erroSenha.message,
    erroConta.message,
    'mensagens diferentes entregariam quais apelidos existem'
  );
});

test('não dá para criar duas contas com o mesmo apelido', () => {
  usuarios.criarContaLocal('Repetido', 'senha1234');
  assert.throws(() => usuarios.criarContaLocal('repetido', 'outra1234'), /Já existe/);
});

test('nome curto demais e senha curta demais são recusados', () => {
  assert.throws(() => usuarios.criarContaLocal('a', 'senha1234'), /pelo menos 2/);
  assert.throws(() => usuarios.criarContaLocal('Nome', '123'), /pelo menos 4/);
});

test('o que vai para o cliente não leva hash nem sal', () => {
  const criada = usuarios.criarContaLocal('Publico', 'senha1234');
  const enviado = usuarios.paraOCliente(criada);
  assert.deepStrictEqual(Object.keys(enviado).sort(), ['id', 'nome', 'provedor']);
});

// ============================================================ 2. sessao

test('a sessão identifica o dono e sobrevive a um F5', () => {
  const criada = usuarios.criarContaLocal('Sessao', 'senha1234');
  const token = usuarios.criarSessao(criada.id);
  assert.strictEqual(usuarios.lerSessao(token).id, criada.id);
});

test('token adulterado, vencido ou inventado não vale', () => {
  const criada = usuarios.criarContaLocal('Cracha', 'senha1234');
  const token = usuarios.criarSessao(criada.id);

  assert.strictEqual(usuarios.lerSessao(token.replace(/.$/, '0')), null, 'assinatura mexida');
  assert.strictEqual(usuarios.lerSessao('qualquer.coisa.aqui'), null, 'token inventado');
  assert.strictEqual(usuarios.lerSessao(''), null);
  assert.strictEqual(usuarios.lerSessao(null), null);

  // Trocar o id mantendo a assinatura antiga também não passa: a assinatura
  // cobre o id, então virar a conta de outra pessoa é impossível.
  const outro = usuarios.criarContaLocal('Outro', 'senha1234');
  const [, expira, assinatura] = token.split('.');
  assert.strictEqual(usuarios.lerSessao(`${outro.id}.${expira}.${assinatura}`), null);

  const vencido = usuarios.criarSessao(criada.id, Date.now() - usuarios.DURACAO_DA_SESSAO_MS - 1000);
  assert.strictEqual(usuarios.lerSessao(vencido), null, 'sessão vencida');
});

// ============================================================ 3. a semana

test('a semana vai de segunda 00:00 a domingo 23:59 no horário de Brasília', () => {
  const segunda = Date.parse('2026-08-17T03:00:00Z'); // segunda 00:00 em UTC-3
  const semana = ranking.semanaAtual(segunda);

  assert.strictEqual(semana.inicio, segunda, 'a semana começa exatamente na segunda 00:00');
  assert.strictEqual(semana.fim, segunda + 7 * 24 * 3600 * 1000 - 1000);

  // Um segundo antes ainda é a semana passada.
  assert.notStrictEqual(ranking.chaveDaSemana(segunda - 1000), semana.chave);
  // Domingo 23:59 ainda é a mesma semana.
  assert.strictEqual(ranking.chaveDaSemana(semana.fim), semana.chave);
  // E a segunda seguinte já é outra.
  assert.notStrictEqual(ranking.chaveDaSemana(semana.fim + 1000), semana.chave);
});

test('a chave da semana ordena sozinha e é estável dentro da semana', () => {
  const quarta = Date.parse('2026-08-19T15:00:00Z');
  const sexta = Date.parse('2026-08-21T09:00:00Z');
  assert.strictEqual(ranking.chaveDaSemana(quarta), ranking.chaveDaSemana(sexta));
  assert.match(ranking.chaveDaSemana(quarta), /^\d{4}-S\d{2}$/);
  assert.ok(ranking.chaveDaSemana(quarta) < ranking.chaveDaSemana(quarta + 7 * 24 * 3600 * 1000));
});

// ============================================================ 4. pontuacao

test('mesa de 2: o vencedor leva 1 ponto e o segundo, nenhum', () => {
  assert.deepStrictEqual([1, 2].map((p) => ranking.pontosDaPosicao(p, 2)), [1, 0]);
});

test('mesa de 3: 2, 1 e 0', () => {
  assert.deepStrictEqual([1, 2, 3].map((p) => ranking.pontosDaPosicao(p, 3)), [2, 1, 0]);
});

test('mesa de 4: a tabela padrão 5, 3, 2, 1', () => {
  assert.deepStrictEqual([1, 2, 3, 4].map((p) => ranking.pontosDaPosicao(p, 4)), [5, 3, 2, 1]);
});

test('mais de 4 jogadores usa o padrão e quem passa do 4º não pontua', () => {
  assert.deepStrictEqual(
    [1, 2, 3, 4, 5, 6].map((p) => ranking.pontosDaPosicao(p, 6)),
    [5, 3, 2, 1, 0, 0]
  );
});

test('mudar a pontuação é mexer numa tabela só', () => {
  // Este teste existe como documentação executável: se um dia a estrutura
  // deixar de ser "posições em ordem", ele quebra e avisa.
  assert.deepStrictEqual(ranking.TABELAS_DE_PONTOS[2], [1, 0]);
  assert.deepStrictEqual(ranking.TABELAS_DE_PONTOS[3], [2, 1, 0]);
  assert.deepStrictEqual(ranking.TABELAS_DE_PONTOS.padrao, [5, 3, 2, 1]);
});

// ============================================================ 5. empates

test('desempate: mais animais no bar; empatando, a menor soma de forças', () => {
  const posicoes = ranking.posicionar([
    { id: 'a', entraram: 3, somaForcas: 20 },
    { id: 'b', entraram: 2, somaForcas: 5 },
    { id: 'c', entraram: 2, somaForcas: 9 },
  ]);
  assert.deepStrictEqual(posicoes.map((p) => [p.id, p.posicao]), [['a', 1], ['b', 2], ['c', 3]]);
});

test('empate de verdade: mesma posição, mesmos pontos, e a seguinte é pulada', () => {
  const posicoes = ranking.posicionar([
    { id: 'a', entraram: 3, somaForcas: 10 },
    { id: 'b', entraram: 3, somaForcas: 10 }, // empatou nos dois critérios
    { id: 'c', entraram: 1, somaForcas: 4 },
  ]);
  assert.deepStrictEqual(posicoes.map((p) => p.posicao), [1, 1, 3]);
  assert.deepStrictEqual(
    posicoes.map((p) => ranking.pontosDaPosicao(p.posicao, 3)),
    [2, 2, 0] // os dois primeiros levam o mesmo; o 3º lugar continua valendo 0
  );
});

// ============================================================ 6. registro

// Monta um resultado no mesmo formato que o motor do jogo produz.
const resultadoCom = (linhas) => ({
  tabela: linhas.slice().sort((a, b) => b.entraram - a.entraram || a.somaForcas - b.somaForcas),
  vencedores: [],
  criterio: 'animais',
  empatados: [],
});

test('uma partida vira pontos das pessoas certas', () => {
  const ana = conta('Ana');
  const bento = conta('Bento');
  const clara = conta('Clara');

  const gravado = ranking.registrarPartida({
    partidaId: 'partida-basica',
    sala: 'AB12',
    resultado: resultadoCom([
      { id: ana.id, nome: ana.nome, entraram: 4, somaForcas: 30 },
      { id: bento.id, nome: bento.nome, entraram: 2, somaForcas: 12 },
      { id: clara.id, nome: clara.nome, entraram: 1, somaForcas: 9 },
    ]),
  });

  assert.strictEqual(gravado.novo, true);
  assert.deepStrictEqual(gravado.jogadores.map((j) => j.pontos), [2, 1, 0]); // mesa de 3
});

test('a mesma partida nunca conta duas vezes', () => {
  const ana = conta('Dupla');
  const bento = conta('Dupla');
  const dados = {
    partidaId: 'partida-repetida',
    resultado: resultadoCom([
      { id: ana.id, entraram: 3, somaForcas: 10 },
      { id: bento.id, entraram: 1, somaForcas: 5 },
    ]),
  };

  assert.strictEqual(ranking.registrarPartida(dados).novo, true);
  assert.strictEqual(ranking.registrarPartida(dados).novo, false, 'a segunda vez é ignorada');
  assert.strictEqual(ranking.registrarPartida(dados).novo, false);

  const linha = ranking.rankingDaSemana().find((j) => j.id === ana.id);
  assert.strictEqual(linha.partidas, 1, 'continua sendo uma partida só');
  assert.strictEqual(linha.pontos, 1);
});

test('o ranking soma várias partidas e ordena por pontos', () => {
  const semana = ranking.chaveDaSemana();
  const forte = conta('Forte');
  const medio = conta('Medio');
  const fraco = conta('Fraco');

  for (let i = 0; i < 3; i++) {
    ranking.registrarPartida({
      partidaId: `soma-${i}`,
      resultado: resultadoCom([
        { id: forte.id, entraram: 4, somaForcas: 20 },
        { id: medio.id, entraram: 2, somaForcas: 10 },
        { id: fraco.id, entraram: 1, somaForcas: 5 },
      ]),
    });
  }

  const tabela = ranking.rankingDaSemana(semana);
  const meu = (id) => tabela.find((l) => l.id === id);
  assert.strictEqual(meu(forte.id).pontos, 6); // 2 pontos x 3 partidas
  assert.strictEqual(meu(medio.id).pontos, 3);
  assert.strictEqual(meu(fraco.id).pontos, 0);
  assert.ok(meu(forte.id).posicao < meu(medio.id).posicao, 'quem tem mais pontos vem antes');
  assert.strictEqual(meu(forte.id).vitorias, 3);
});

test('virar a semana zera o ranking mas não apaga o passado', () => {
  const semanaPassada = Date.parse('2026-08-12T15:00:00Z'); // uma quarta
  const estaSemana = Date.parse('2026-08-19T15:00:00Z'); // a quarta seguinte
  const chaveVelha = ranking.chaveDaSemana(semanaPassada);
  const chaveNova = ranking.chaveDaSemana(estaSemana);
  assert.notStrictEqual(chaveVelha, chaveNova);

  const veterano = conta('Veterano');
  const novato = conta('Novato');

  ranking.registrarPartida({
    partidaId: 'semana-passada',
    quando: semanaPassada,
    resultado: resultadoCom([
      { id: veterano.id, entraram: 4, somaForcas: 20 },
      { id: novato.id, entraram: 1, somaForcas: 5 },
    ]),
  });

  // Na semana nova, quem pontuou na semana passada começa do zero...
  const agora = ranking.rankingDaSemana(chaveNova);
  assert.ok(!agora.some((l) => l.id === veterano.id), 'a semana nova começa vazia para ele');

  // ...mas a semana passada continua consultável, inteira.
  const antes = ranking.rankingDaSemana(chaveVelha);
  assert.strictEqual(antes.find((l) => l.id === veterano.id).pontos, 1);

  assert.ok(
    ranking.semanasComPartidas().some((s) => s.semana === chaveVelha),
    'a semana antiga aparece no histórico'
  );
  assert.strictEqual(ranking.partidasDoUsuario(veterano.id).length, 1);
});

test('partida sem identificação é recusada', () => {
  assert.throws(() => ranking.registrarPartida({ resultado: resultadoCom([]) }), /identificação/);
});

// ============================================================ 7. de ponta a ponta

test('uma partida de verdade, do início ao fim, vira pontos', () => {
  const ana = conta('PontaA');
  const bento = conta('PontaB');

  // O id da conta é o id do jogador dentro do jogo - é isso que amarra a
  // partida à pessoa sem nenhuma tradução no meio.
  const estado = criarEstado([
    { id: ana.id, nome: ana.nome },
    { id: bento.id, nome: bento.nome },
  ]);

  let guarda = 0;
  while (estado.fase === 'jogando' && guarda++ < 60) {
    const vez = estado.jogadores[estado.vezDe];
    const carta = vez.mao[0];
    const escolha =
      carta.animal === 'coelho' ? { pulos: 1 }
      : carta.animal === 'tucano' ? { alvoUid: estado.fila[0]?.uid }
      : carta.animal === 'polvo' ? { especie: estado.fila[0]?.animal, pulos: 1, alvoUid: estado.fila[0]?.uid }
      : null;
    jogarCarta(estado, vez.id, carta.uid, escolha);
  }

  assert.strictEqual(estado.fase, 'terminado', 'a partida terminou sozinha');
  assert.ok(estado.partidaId, 'a partida tem identificação própria');

  const gravado = ranking.registrarPartida({
    partidaId: estado.partidaId,
    resultado: calcularResultado(estado),
  });

  assert.strictEqual(gravado.novo, true);
  // Mesa de 2: alguém leva 1 ponto e alguém leva 0 (ou 1 e 1 se empatarem em tudo).
  const total = gravado.jogadores.reduce((soma, j) => soma + j.pontos, 0);
  assert.ok(total >= 1 && total <= 2, `pontos distribuídos: ${total}`);
  assert.strictEqual(gravado.jogadores.length, 2);
});
