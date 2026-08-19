// Testes de contas e ranking. Rode com: npm test
//
// Tudo roda num banco de memoria: nenhum arquivo e criado, nada do que ja
// existe no seu computador e tocado, e cada execucao comeca do zero.

process.env.BANCO_CAMINHO = ':memory:';
process.env.SESSAO_SEGREDO = 'segredo-so-de-teste';

const { test, before } = require('node:test');
const assert = require('node:assert');

const banco = require('../server/dados/banco');
const usuarios = require('../server/dados/usuarios');
const ranking = require('../server/dados/ranking');
const { criarEstado, jogarCarta, calcularResultado } = require('../server/game/gameState');

let contador = 0;

// O banco agora e assincrono e precisa ser aberto uma vez antes de tudo. Em
// ':memory:' isso nao toca em disco nenhum.
before(() => banco.abrir());

// Uma conta completa: e-mail + apelido + senha.
const conta = (nome, senha = 'senha1234') => {
  const apelido = `${nome}${++contador}`;
  return usuarios.criarConta({
    email: `${apelido.toLowerCase()}@exemplo.test`,
    apelido,
    senha,
  });
};

// Roda a funcao e devolve o erro que ela lancou (ou null).
async function oQueDeuErrado(acao) {
  try {
    await acao();
    return null;
  } catch (erro) {
    return erro;
  }
}

// ============================================================ 1. cadastro

test('cria uma conta com e-mail, apelido e senha, e entra com ela', async () => {
  const criada = await usuarios.criarConta({
    email: 'victor@exemplo.test',
    apelido: 'Victor',
    senha: 'batatinha',
  });
  assert.strictEqual(criada.apelido, 'Victor');
  assert.strictEqual(criada.email, 'victor@exemplo.test');
  assert.ok(criada.id, 'a conta precisa de um identificador único');
  assert.ok(criada.criado_em, 'e nasce pronta para jogar, sem etapa nenhuma no meio');

  assert.strictEqual((await usuarios.entrarComSenha('Victor', 'batatinha')).id, criada.id);
});

test('dá para entrar pelo apelido OU pelo e-mail', async () => {
  const criada = await conta('Dois');
  assert.strictEqual((await usuarios.entrarComSenha(criada.apelido, 'senha1234')).id, criada.id);
  assert.strictEqual((await usuarios.entrarComSenha(criada.email, 'senha1234')).id, criada.id);
});

test('sem e-mail não existe cadastro', async () => {
  const erro = await oQueDeuErrado(async () =>
    await usuarios.criarConta({ email: '', apelido: 'SemEmail', senha: 'senha1234' })
  );
  assert.match(erro.message, /e-mail/i);
  assert.strictEqual(await usuarios.porApelido('SemEmail'), null, 'e a conta não foi criada');
});

test('e-mail malformado é recusado', async () => {
  for (const ruim of ['abc', 'a@b', 'sem arroba.com', '@exemplo.test', 'a b@c.com']) {
    const erro = await oQueDeuErrado(async () =>
      await usuarios.criarConta({ email: ruim, apelido: `Ruim${++contador}`, senha: 'senha1234' })
    );
    assert.ok(erro, `deveria recusar "${ruim}"`);
  }
});

test('e-mail repetido é recusado, sem diferenciar maiúsculas', async () => {
  await usuarios.criarConta({ email: 'igual@exemplo.test', apelido: 'PrimeiroAqui', senha: 'senha1234' });
  const erro = await oQueDeuErrado(async () =>
    await usuarios.criarConta({ email: 'IGUAL@Exemplo.Test', apelido: 'SegundoAqui', senha: 'senha1234' })
  );
  assert.match(erro.message, /Já existe uma conta com esse e-mail/);
});

test('apelido repetido é recusado', async () => {
  await usuarios.criarConta({ email: 'r1@exemplo.test', apelido: 'Repetido', senha: 'senha1234' });
  const erro = await oQueDeuErrado(async () =>
    await usuarios.criarConta({ email: 'r2@exemplo.test', apelido: 'repetido', senha: 'outra1234' })
  );
  assert.match(erro.message, /já está em uso/);
});

test('apelido curto ou com símbolos estranhos é recusado', async () => {
  assert.ok(await oQueDeuErrado(async () => await usuarios.criarConta({ email: 'a@b.com', apelido: 'ab', senha: 'senha1234' })));
  assert.ok(await oQueDeuErrado(async () => await usuarios.criarConta({ email: 'a@b.com', apelido: 'a b<c>', senha: 'senha1234' })));
});

// ============================================================ 2. senhas

test('a senha nunca é guardada em texto puro', async () => {
  const criada = await conta('Segredo', 'minhasenha');
  assert.ok(criada.senha_hash && criada.senha_hash !== 'minhasenha');
  assert.ok(criada.senha_sal, 'cada conta tem o próprio sal');

  // Duas contas com a MESMA senha têm hashes diferentes - é para isso que
  // serve o sal: uma tabela de senhas prontas não serve para nada.
  assert.notStrictEqual(criada.senha_hash, (await conta('Segredo', 'minhasenha')).senha_hash);
});

test('senha errada não entra, e o erro não revela se a conta existe', async () => {
  const criada = await conta('Maria', 'certa1234');
  const erroSenha = await oQueDeuErrado(async () => await usuarios.entrarComSenha(criada.apelido, 'errada'));
  const erroConta = await oQueDeuErrado(async () => await usuarios.entrarComSenha('NinguemAssim', 'errada'));

  assert.ok(erroSenha && erroConta, 'os dois casos precisam recusar');
  assert.strictEqual(
    erroSenha.message,
    erroConta.message,
    'mensagens diferentes entregariam quais apelidos existem'
  );
});

test('o que vai para o cliente não leva hash nem sal', async () => {
  const enviado = usuarios.paraOCliente(await conta('Publico'));
  assert.deepStrictEqual(Object.keys(enviado).sort(), ['email', 'id', 'nome']);
  assert.ok(!JSON.stringify(enviado).includes('hash'));
});

// ==================================== 3. senha nova definida pelo administrador
//
// A recuperação de conta deste jogo. Não há link por e-mail: o servidor
// gratuito onde ele roda bloqueia envio. Quem esquece a senha fala com o dono,
// que define uma nova pelo painel /admin - e é usuarios.definirSenha que faz
// isso, sem pedir a senha antiga.

test('o administrador define uma senha nova sem saber a antiga', async () => {
  const criada = await conta('Esquecido', 'velha1234');

  await usuarios.definirSenha(criada.id, 'nova12345');

  assert.ok(await usuarios.entrarComSenha(criada.apelido, 'nova12345'), 'a senha nova funciona');
  assert.ok(
    await oQueDeuErrado(() => usuarios.entrarComSenha(criada.apelido, 'velha1234')),
    'e a antiga deixa de funcionar na hora'
  );
});

test('a senha definida pelo administrador também precisa ser válida', async () => {
  const criada = await conta('Curta');
  const erro = await oQueDeuErrado(() => usuarios.definirSenha(criada.id, '123'));
  assert.match(erro.message, /pelo menos/);
});

test('definir senha para uma conta que não existe não cria nada', async () => {
  const erro = await oQueDeuErrado(() => usuarios.definirSenha('id-inventado', 'senha1234'));
  assert.match(erro.message, /não encontrada/i);
});

test('a senha nova também é guardada como hash, nunca em texto', async () => {
  // Vale para o caminho do administrador igual ao do cadastro: nem ele lê senha.
  const criada = await conta('HashDeNovo');
  await usuarios.definirSenha(criada.id, 'texto-puro-123');

  const depois = await usuarios.porId(criada.id);
  assert.notStrictEqual(depois.senha_hash, 'texto-puro-123');
  assert.ok(!JSON.stringify(depois).includes('texto-puro-123'), 'a senha não pode estar em lugar nenhum');
});

test('o e-mail continua obrigatório, mesmo sem confirmação por link', async () => {
  // Ele é como o administrador identifica de quem é cada conta quando alguém
  // pede uma senha nova.
  const erro = await oQueDeuErrado(() =>
    usuarios.criarConta({ email: '', apelido: 'SemEmailAgora', senha: 'senha1234' })
  );
  assert.match(erro.message, /e-mail/i);
});

test('trocar a senha estando logado exige a senha atual', async () => {
  const criada = await conta('Troca', 'atual1234');
  assert.ok(await oQueDeuErrado(async () => await usuarios.trocarSenha(criada.id, 'chutei', 'nova12345')));
  await usuarios.trocarSenha(criada.id, 'atual1234', 'nova12345');
  assert.ok(await usuarios.entrarComSenha(criada.apelido, 'nova12345'));
});

// ============================================================ 6. sessão

test('a sessão identifica o dono e sobrevive a um F5', async () => {
  const criada = await conta('Sessao');
  assert.strictEqual((await usuarios.lerSessao(usuarios.criarSessao(criada.id))).id, criada.id);
});

test('token adulterado, vencido ou inventado não vale', async () => {
  const criada = await conta('Cracha');
  const token = usuarios.criarSessao(criada.id);

  // Mexe no ÚLTIMO caractere da assinatura. Trocar sempre por '0' seria um teste
  // que passa quase sempre: quando o último caractere já fosse '0', o crachá
  // continuaria idêntico e válido. Aqui a troca muda o token com certeza.
  const mexido = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
  assert.strictEqual(await usuarios.lerSessao(mexido), null, 'assinatura mexida');
  assert.strictEqual(await usuarios.lerSessao('qualquer.coisa.aqui'), null, 'token inventado');
  assert.strictEqual(await usuarios.lerSessao(''), null);
  assert.strictEqual(await usuarios.lerSessao(null), null);

  // Trocar o id mantendo a assinatura antiga também não passa.
  const outro = await conta('Outro');
  const [, expira, assinatura] = token.split('.');
  assert.strictEqual(await usuarios.lerSessao(`${outro.id}.${expira}.${assinatura}`), null);

  const vencido = usuarios.criarSessao(criada.id, Date.now() - usuarios.DURACAO_DA_SESSAO_MS - 1000);
  assert.strictEqual(await usuarios.lerSessao(vencido), null, 'sessão vencida');
});

// ============================================================ 3. a semana

test('a semana vai de segunda 00:00 a domingo 23:59 no horário de Brasília', async () => {
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

test('a chave da semana ordena sozinha e é estável dentro da semana', async () => {
  const quarta = Date.parse('2026-08-19T15:00:00Z');
  const sexta = Date.parse('2026-08-21T09:00:00Z');
  assert.strictEqual(ranking.chaveDaSemana(quarta), ranking.chaveDaSemana(sexta));
  assert.match(ranking.chaveDaSemana(quarta), /^\d{4}-S\d{2}$/);
  assert.ok(ranking.chaveDaSemana(quarta) < ranking.chaveDaSemana(quarta + 7 * 24 * 3600 * 1000));
});

// ============================================================ 4. pontuacao

test('mesa de 2: o vencedor leva 1 ponto e o segundo, nenhum', async () => {
  assert.deepStrictEqual([1, 2].map((p) => ranking.pontosDaPosicao(p, 2)), [1, 0]);
});

test('mesa de 3: 2, 1 e 0', async () => {
  assert.deepStrictEqual([1, 2, 3].map((p) => ranking.pontosDaPosicao(p, 3)), [2, 1, 0]);
});

test('mesa de 4: a tabela padrão 5, 3, 2, 1', async () => {
  assert.deepStrictEqual([1, 2, 3, 4].map((p) => ranking.pontosDaPosicao(p, 4)), [5, 3, 2, 1]);
});

test('mais de 4 jogadores usa o padrão e quem passa do 4º não pontua', async () => {
  assert.deepStrictEqual(
    [1, 2, 3, 4, 5, 6].map((p) => ranking.pontosDaPosicao(p, 6)),
    [5, 3, 2, 1, 0, 0]
  );
});

test('mudar a pontuação é mexer numa tabela só', async () => {
  // Este teste existe como documentação executável: se um dia a estrutura
  // deixar de ser "posições em ordem", ele quebra e avisa.
  assert.deepStrictEqual(ranking.TABELAS_DE_PONTOS[2], [1, 0]);
  assert.deepStrictEqual(ranking.TABELAS_DE_PONTOS[3], [2, 1, 0]);
  assert.deepStrictEqual(ranking.TABELAS_DE_PONTOS.padrao, [5, 3, 2, 1]);
});

// ============================================================ 5. empates

test('desempate: mais animais no bar; empatando, a menor soma de forças', async () => {
  const posicoes = ranking.posicionar([
    { id: 'a', entraram: 3, somaForcas: 20 },
    { id: 'b', entraram: 2, somaForcas: 5 },
    { id: 'c', entraram: 2, somaForcas: 9 },
  ]);
  assert.deepStrictEqual(posicoes.map((p) => [p.id, p.posicao]), [['a', 1], ['b', 2], ['c', 3]]);
});

test('empate de verdade: mesma posição, mesmos pontos, e a seguinte é pulada', async () => {
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

test('uma partida vira pontos das pessoas certas', async () => {
  const ana = await conta('Ana');
  const bento = await conta('Bento');
  const clara = await conta('Clara');

  const gravado = await ranking.registrarPartida({
    partidaId: 'partida-basica',
    sala: 'AB12',
    resultado: resultadoCom([
      { id: ana.id, nome: ana.apelido, entraram: 4, somaForcas: 30 },
      { id: bento.id, nome: bento.apelido, entraram: 2, somaForcas: 12 },
      { id: clara.id, nome: clara.apelido, entraram: 1, somaForcas: 9 },
    ]),
  });

  assert.strictEqual(gravado.novo, true);
  assert.deepStrictEqual(gravado.jogadores.map((j) => j.pontos), [2, 1, 0]); // mesa de 3
});

test('a mesma partida nunca conta duas vezes', async () => {
  const ana = await conta('Dupla');
  const bento = await conta('Dupla');
  const dados = {
    partidaId: 'partida-repetida',
    resultado: resultadoCom([
      { id: ana.id, entraram: 3, somaForcas: 10 },
      { id: bento.id, entraram: 1, somaForcas: 5 },
    ]),
  };

  assert.strictEqual((await ranking.registrarPartida(dados)).novo, true);
  assert.strictEqual((await ranking.registrarPartida(dados)).novo, false, 'a segunda vez é ignorada');
  assert.strictEqual((await ranking.registrarPartida(dados)).novo, false);

  const linha = (await ranking.rankingDaSemana()).find((j) => j.id === ana.id);
  assert.strictEqual(linha.partidas, 1, 'continua sendo uma partida só');
  assert.strictEqual(linha.pontos, 1);
});

test('o ranking soma várias partidas e ordena por pontos', async () => {
  const semana = ranking.chaveDaSemana();
  const forte = await conta('Forte');
  const medio = await conta('Medio');
  const fraco = await conta('Fraco');

  for (let i = 0; i < 3; i++) {
    await ranking.registrarPartida({
      partidaId: `soma-${i}`,
      resultado: resultadoCom([
        { id: forte.id, entraram: 4, somaForcas: 20 },
        { id: medio.id, entraram: 2, somaForcas: 10 },
        { id: fraco.id, entraram: 1, somaForcas: 5 },
      ]),
    });
  }

  const tabela = await ranking.rankingDaSemana(semana);
  const meu = (id) => tabela.find((l) => l.id === id);
  assert.strictEqual(meu(forte.id).pontos, 6); // 2 pontos x 3 partidas
  assert.strictEqual(meu(medio.id).pontos, 3);
  assert.strictEqual(meu(fraco.id).pontos, 0);
  assert.ok(meu(forte.id).posicao < meu(medio.id).posicao, 'quem tem mais pontos vem antes');
  assert.strictEqual(meu(forte.id).vitorias, 3);
});

test('virar a semana zera o ranking mas não apaga o passado', async () => {
  const semanaPassada = Date.parse('2026-08-12T15:00:00Z'); // uma quarta
  const estaSemana = Date.parse('2026-08-19T15:00:00Z'); // a quarta seguinte
  const chaveVelha = ranking.chaveDaSemana(semanaPassada);
  const chaveNova = ranking.chaveDaSemana(estaSemana);
  assert.notStrictEqual(chaveVelha, chaveNova);

  const veterano = await conta('Veterano');
  const novato = await conta('Novato');

  await ranking.registrarPartida({
    partidaId: 'semana-passada',
    quando: semanaPassada,
    resultado: resultadoCom([
      { id: veterano.id, entraram: 4, somaForcas: 20 },
      { id: novato.id, entraram: 1, somaForcas: 5 },
    ]),
  });

  // Na semana nova, quem pontuou na semana passada começa do zero...
  const agora = await ranking.rankingDaSemana(chaveNova);
  assert.ok(!agora.some((l) => l.id === veterano.id), 'a semana nova começa vazia para ele');

  // ...mas a semana passada continua consultável, inteira.
  const antes = await ranking.rankingDaSemana(chaveVelha);
  assert.strictEqual(antes.find((l) => l.id === veterano.id).pontos, 1);

  assert.ok(
    (await ranking.semanasComPartidas()).some((s) => s.semana === chaveVelha),
    'a semana antiga aparece no histórico'
  );
  assert.strictEqual((await ranking.partidasDoUsuario(veterano.id)).length, 1);
});

test('partida sem identificação é recusada', async () => {
  assert.match((await oQueDeuErrado(() => ranking.registrarPartida({ resultado: resultadoCom([]) }))).message, /identificação/);
});

// ============================================================ 7. de ponta a ponta

test('uma partida de verdade, do início ao fim, vira pontos', async () => {
  const ana = await conta('PontaA');
  const bento = await conta('PontaB');

  // O id da conta é o id do jogador dentro do jogo - é isso que amarra a
  // partida à pessoa sem nenhuma tradução no meio.
  const estado = criarEstado([
    { id: ana.id, nome: ana.apelido },
    { id: bento.id, nome: bento.apelido },
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

  const gravado = await ranking.registrarPartida({
    partidaId: estado.partidaId,
    resultado: calcularResultado(estado),
  });

  assert.strictEqual(gravado.novo, true);
  // Mesa de 2: alguém leva 1 ponto e alguém leva 0 (ou 1 e 1 se empatarem em tudo).
  const total = gravado.jogadores.reduce((soma, j) => soma + j.pontos, 0);
  assert.ok(total >= 1 && total <= 2, `pontos distribuídos: ${total}`);
  assert.strictEqual(gravado.jogadores.length, 2);
});
