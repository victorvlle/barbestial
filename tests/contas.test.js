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

const tokens = require('../server/dados/tokens');

// Uma conta completa: e-mail + apelido + senha.
const conta = (nome, senha = 'senha1234') => {
  const apelido = `${nome}${++contador}`;
  return usuarios.criarConta({
    email: `${apelido.toLowerCase()}@exemplo.test`,
    apelido,
    senha,
  });
};

// Uma conta que já confirmou o e-mail - é o que o ranking exige para mostrar
// alguém. Os testes de ranking usam esta.
const contaConfirmada = (nome, senha = 'senha1234') => confirmar(conta(nome, senha));

// Confirma o e-mail de uma conta pelo caminho de verdade: cria o token e
// consome, exatamente como o clique no link faria.
function confirmar(usuario) {
  const token = tokens.criar(usuario.id, 'verificar');
  return usuarios.marcarEmailVerificado(tokens.consumir(token, 'verificar'));
}

// Roda a funcao e devolve o erro que ela lancou (ou null).
function oQueDeuErrado(acao) {
  try {
    acao();
    return null;
  } catch (erro) {
    return erro;
  }
}

// ============================================================ 1. cadastro

test('cria uma conta com e-mail, apelido e senha, e entra com ela', () => {
  const criada = usuarios.criarConta({
    email: 'victor@exemplo.test',
    apelido: 'Victor',
    senha: 'batatinha',
  });
  assert.strictEqual(criada.apelido, 'Victor');
  assert.strictEqual(criada.email, 'victor@exemplo.test');
  assert.ok(criada.id, 'a conta precisa de um identificador único');
  assert.strictEqual(criada.email_verificado_em, null, 'nasce sem confirmar');

  assert.strictEqual(usuarios.entrarComSenha('Victor', 'batatinha').id, criada.id);
});

test('dá para entrar pelo apelido OU pelo e-mail', () => {
  const criada = conta('Dois');
  assert.strictEqual(usuarios.entrarComSenha(criada.apelido, 'senha1234').id, criada.id);
  assert.strictEqual(usuarios.entrarComSenha(criada.email, 'senha1234').id, criada.id);
});

test('sem e-mail não existe cadastro', () => {
  const erro = oQueDeuErrado(() =>
    usuarios.criarConta({ email: '', apelido: 'SemEmail', senha: 'senha1234' })
  );
  assert.match(erro.message, /e-mail/i);
  assert.strictEqual(usuarios.porApelido('SemEmail'), null, 'e a conta não foi criada');
});

test('e-mail malformado é recusado', () => {
  for (const ruim of ['abc', 'a@b', 'sem arroba.com', '@exemplo.test', 'a b@c.com']) {
    const erro = oQueDeuErrado(() =>
      usuarios.criarConta({ email: ruim, apelido: `Ruim${++contador}`, senha: 'senha1234' })
    );
    assert.ok(erro, `deveria recusar "${ruim}"`);
  }
});

test('e-mail repetido é recusado, sem diferenciar maiúsculas', () => {
  usuarios.criarConta({ email: 'igual@exemplo.test', apelido: 'PrimeiroAqui', senha: 'senha1234' });
  const erro = oQueDeuErrado(() =>
    usuarios.criarConta({ email: 'IGUAL@Exemplo.Test', apelido: 'SegundoAqui', senha: 'senha1234' })
  );
  assert.match(erro.message, /Já existe uma conta com esse e-mail/);
});

test('apelido repetido é recusado', () => {
  usuarios.criarConta({ email: 'r1@exemplo.test', apelido: 'Repetido', senha: 'senha1234' });
  const erro = oQueDeuErrado(() =>
    usuarios.criarConta({ email: 'r2@exemplo.test', apelido: 'repetido', senha: 'outra1234' })
  );
  assert.match(erro.message, /já está em uso/);
});

test('apelido curto ou com símbolos estranhos é recusado', () => {
  assert.ok(oQueDeuErrado(() => usuarios.criarConta({ email: 'a@b.com', apelido: 'ab', senha: 'senha1234' })));
  assert.ok(oQueDeuErrado(() => usuarios.criarConta({ email: 'a@b.com', apelido: 'a b<c>', senha: 'senha1234' })));
});

// ============================================================ 2. senhas

test('a senha nunca é guardada em texto puro', () => {
  const criada = conta('Segredo', 'minhasenha');
  assert.ok(criada.senha_hash && criada.senha_hash !== 'minhasenha');
  assert.ok(criada.senha_sal, 'cada conta tem o próprio sal');

  // Duas contas com a MESMA senha têm hashes diferentes - é para isso que
  // serve o sal: uma tabela de senhas prontas não serve para nada.
  assert.notStrictEqual(criada.senha_hash, conta('Segredo', 'minhasenha').senha_hash);
});

test('senha errada não entra, e o erro não revela se a conta existe', () => {
  const criada = conta('Maria', 'certa1234');
  const erroSenha = oQueDeuErrado(() => usuarios.entrarComSenha(criada.apelido, 'errada'));
  const erroConta = oQueDeuErrado(() => usuarios.entrarComSenha('NinguemAssim', 'errada'));

  assert.ok(erroSenha && erroConta, 'os dois casos precisam recusar');
  assert.strictEqual(
    erroSenha.message,
    erroConta.message,
    'mensagens diferentes entregariam quais apelidos existem'
  );
});

test('o que vai para o cliente não leva hash nem sal', () => {
  const enviado = usuarios.paraOCliente(conta('Publico'));
  assert.deepStrictEqual(Object.keys(enviado).sort(), ['email', 'id', 'nome', 'verificado']);
  assert.ok(!JSON.stringify(enviado).includes('hash'));
});

// ============================================================ 3. verificação

test('a conta nasce sem confirmar e o link confirma', () => {
  const criada = conta('Confirmando');
  assert.strictEqual(usuarios.verificado(criada), false);

  const depois = confirmar(criada);
  assert.ok(depois.email_verificado_em, 'ficou com a data da confirmação');
  assert.strictEqual(usuarios.verificado(depois), true);
});

test('confirmar duas vezes não quebra nem muda a data', () => {
  const criada = conta('Duas');
  const primeira = confirmar(criada);
  const segunda = usuarios.marcarEmailVerificado(criada.id);
  assert.strictEqual(segunda.email_verificado_em, primeira.email_verificado_em);
});

test('quem digitou o e-mail errado pode corrigir, e volta a não confirmado', () => {
  const criada = conta('Errou');
  usuarios.trocarEmail(criada.id, 'certo@exemplo.test');
  const depois = usuarios.porId(criada.id);
  assert.strictEqual(depois.email, 'certo@exemplo.test');
  assert.strictEqual(depois.email_verificado_em, null);

  // E não dá para roubar o e-mail de outra conta.
  const outra = conta('Outra');
  const erro = oQueDeuErrado(() => usuarios.trocarEmail(criada.id, outra.email));
  assert.match(erro.message, /Já existe uma conta/);
});

// ============================================================ 4. tokens

test('o token é de uso único', () => {
  const criada = conta('UsoUnico');
  const token = tokens.criar(criada.id, 'recuperar');

  assert.strictEqual(tokens.consumir(token, 'recuperar'), criada.id);
  const erro = oQueDeuErrado(() => tokens.consumir(token, 'recuperar'));
  assert.match(erro.message, /já foi usado/);
});

test('o token expira', () => {
  const criada = conta('Expirado');
  const token = tokens.criar(criada.id, 'recuperar');
  const depoisDoPrazo = Date.now() + tokens.VALIDADE.recuperar + 1000;

  const erro = oQueDeuErrado(() => tokens.consumir(token, 'recuperar', depoisDoPrazo));
  assert.match(erro.message, /expirou/);
});

test('pedir um link novo invalida o anterior', () => {
  // Senão cada clique em "esqueci a senha" deixaria mais uma chave válida
  // circulando pela caixa de entrada.
  const criada = conta('Novo');
  const antigo = tokens.criar(criada.id, 'recuperar');
  const recente = tokens.criar(criada.id, 'recuperar');

  assert.ok(oQueDeuErrado(() => tokens.consumir(antigo, 'recuperar')), 'o antigo morreu');
  assert.strictEqual(tokens.consumir(recente, 'recuperar'), criada.id);
});

test('token de um tipo não serve para o outro', () => {
  // Um link de confirmação de e-mail não pode virar um link de trocar senha.
  const criada = conta('Tipos');
  const verificacao = tokens.criar(criada.id, 'verificar');
  assert.ok(oQueDeuErrado(() => tokens.consumir(verificacao, 'recuperar')));
});

test('token inventado não vale', () => {
  assert.ok(oQueDeuErrado(() => tokens.consumir('inventei-esse-aqui', 'recuperar')));
  assert.ok(oQueDeuErrado(() => tokens.consumir('', 'recuperar')));
  assert.ok(oQueDeuErrado(() => tokens.consumir(null, 'verificar')));
});

test('o banco guarda o HASH do token, nunca o token', () => {
  // Se o banco vazar, os links que estiverem lá dentro não abrem nada.
  const criada = conta('Hashado');
  const token = tokens.criar(criada.id, 'recuperar');
  const linhas = require('../server/dados/banco').abrir().prepare('SELECT * FROM tokens').all();
  assert.ok(linhas.length > 0);
  assert.ok(!linhas.some((l) => l.hash === token), 'o valor original não pode estar no banco');
});

// ============================================================ 5. recuperação

test('o link do e-mail define a senha nova e já confirma o e-mail', () => {
  const criada = conta('Esquecido', 'velha1234');
  assert.strictEqual(usuarios.verificado(criada), false);

  const token = tokens.criar(criada.id, 'recuperar');
  const depois = usuarios.definirSenhaPorToken(tokens.consumir(token, 'recuperar'), 'nova12345');

  assert.ok(usuarios.entrarComSenha(criada.apelido, 'nova12345'), 'a senha nova funciona');
  assert.ok(
    oQueDeuErrado(() => usuarios.entrarComSenha(criada.apelido, 'velha1234')),
    'e a antiga deixa de funcionar'
  );
  // Quem abriu o link provou que a caixa de entrada é dele - que é justamente
  // o que a confirmação queria descobrir.
  assert.ok(depois.email_verificado_em, 'o e-mail fica confirmado de brinde');
});

test('SABER O APELIDO NÃO RECUPERA NADA', () => {
  // O ponto central do desenho: a recuperação começa por um e-mail que só o
  // dono recebe. Conhecer o apelido - que aparece no ranking para todo mundo -
  // não dá nenhum passo em direção à conta.
  const vitima = conta('Alvo', 'senha1234');
  const atacante = conta('Atacante');
  // O apelido real tem sufixo (Alvo1, Alvo2...) porque os testes rodam em
  // sequência no mesmo banco.

  // O atacante só consegue gerar token para a conta DELE.
  const token = tokens.criar(atacante.id, 'recuperar');
  const mexeu = usuarios.definirSenhaPorToken(tokens.consumir(token, 'recuperar'), 'senha-do-atacante');

  assert.strictEqual(mexeu.id, atacante.id, 'ele só trocou a própria senha');
  assert.ok(
    usuarios.entrarComSenha(vitima.apelido, 'senha1234'),
    'a senha da vítima continua valendo'
  );
});

test('recuperação também exige senha nova válida', () => {
  const criada = conta('Curta');
  const token = tokens.criar(criada.id, 'recuperar');
  const erro = oQueDeuErrado(() =>
    usuarios.definirSenhaPorToken(tokens.consumir(token, 'recuperar'), '123')
  );
  assert.match(erro.message, /pelo menos/);
});

test('trocar a senha estando logado exige a senha atual', () => {
  const criada = conta('Troca', 'atual1234');
  assert.ok(oQueDeuErrado(() => usuarios.trocarSenha(criada.id, 'chutei', 'nova12345')));
  usuarios.trocarSenha(criada.id, 'atual1234', 'nova12345');
  assert.ok(usuarios.entrarComSenha(criada.apelido, 'nova12345'));
});

// ============================================================ 6. sessão

test('a sessão identifica o dono e sobrevive a um F5', () => {
  const criada = conta('Sessao');
  assert.strictEqual(usuarios.lerSessao(usuarios.criarSessao(criada.id)).id, criada.id);
});

test('token adulterado, vencido ou inventado não vale', () => {
  const criada = conta('Cracha');
  const token = usuarios.criarSessao(criada.id);

  // Mexe no ÚLTIMO caractere da assinatura. Trocar sempre por '0' seria um teste
  // que passa quase sempre: quando o último caractere já fosse '0', o crachá
  // continuaria idêntico e válido. Aqui a troca muda o token com certeza.
  const mexido = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
  assert.strictEqual(usuarios.lerSessao(mexido), null, 'assinatura mexida');
  assert.strictEqual(usuarios.lerSessao('qualquer.coisa.aqui'), null, 'token inventado');
  assert.strictEqual(usuarios.lerSessao(''), null);
  assert.strictEqual(usuarios.lerSessao(null), null);

  // Trocar o id mantendo a assinatura antiga também não passa.
  const outro = conta('Outro');
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
  const ana = contaConfirmada('Ana');
  const bento = contaConfirmada('Bento');
  const clara = contaConfirmada('Clara');

  const gravado = ranking.registrarPartida({
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

test('a mesma partida nunca conta duas vezes', () => {
  const ana = contaConfirmada('Dupla');
  const bento = contaConfirmada('Dupla');
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
  const forte = contaConfirmada('Forte');
  const medio = contaConfirmada('Medio');
  const fraco = contaConfirmada('Fraco');

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

  const veterano = contaConfirmada('Veterano');
  const novato = contaConfirmada('Novato');

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
  const ana = contaConfirmada('PontaA');
  const bento = contaConfirmada('PontaB');

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
