// Ranking semanal: quando comeca a semana, quanto vale cada posicao, e como
// uma partida terminada vira pontos.
//
// Este arquivo nao conhece Socket.IO nem Express. Ele recebe o resultado que o
// motor do jogo ja calculou e guarda. Da para testar tudo aqui sem subir servidor.

const banco = require('./banco');

// ============================================================================
// 1. A SEMANA
// ============================================================================
//
// Combinado: a semana vai de SEGUNDA 00:00 ate DOMINGO 23:59:59.
//
// Fuso: as datas nascem em UTC dentro do Node, mas "segunda-feira" tem que ser
// a segunda-feira de quem joga. FUSO_MINUTOS resolve isso: -180 = UTC-3, o
// horario de Brasilia. O Brasil nao tem mais horario de verao, entao um numero
// fixo esta correto o ano inteiro. Quem jogar de outro fuso muda a variavel.
//
// A chave de uma semana e um texto tipo "2026-S33": ordena sozinha, aparece
// legivel no banco e nao depende de fuso na hora de comparar.
//
// RESET: nada e apagado nem zerado quando a semana vira. Cada resultado nasce
// carimbado com a semana dele; o ranking so filtra pela semana atual. Por isso
// o historico continua inteiro e um ranking antigo pode ser consultado a
// qualquer momento - e por isso tambem que "zerar" e automatico: na segunda de
// manha a chave muda e a consulta simplesmente nao encontra mais nada.

const FUSO_MINUTOS = Number(process.env.FUSO_MINUTOS ?? -180);

const DIA_MS = 24 * 60 * 60 * 1000;

// O instante, deslocado para o fuso do jogador, para podermos usar os metodos
// UTC do Date e ainda assim raciocinar em horario local.
const emLocal = (instante) => new Date(instante + FUSO_MINUTOS * 60 * 1000);

// Segunda-feira 00:00 (horario local) da semana a que o instante pertence.
function inicioDaSemana(instante = Date.now()) {
  const local = emLocal(instante);
  const diaDaSemana = (local.getUTCDay() + 6) % 7; // 0 = segunda ... 6 = domingo
  const meiaNoiteLocal = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate()
  );
  return meiaNoiteLocal - diaDaSemana * DIA_MS - FUSO_MINUTOS * 60 * 1000;
}

// Numero da semana no ano, contado a partir da primeira segunda-feira.
function chaveDaSemana(instante = Date.now()) {
  const inicio = inicioDaSemana(instante);
  const local = emLocal(inicio);
  const ano = local.getUTCFullYear();

  const primeiroDoAno = new Date(Date.UTC(ano, 0, 1));
  const ateSegunda = (8 - ((primeiroDoAno.getUTCDay() + 6) % 7 || 7)) % 7;
  const primeiraSegunda = Date.UTC(ano, 0, 1 + ateSegunda);

  const numero = Math.floor((Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - primeiraSegunda) / (7 * DIA_MS)) + 1;
  return `${ano}-S${String(numero).padStart(2, '0')}`;
}

// Tudo que a interface precisa para escrever "semana de 10 a 16 de agosto".
function semanaAtual(instante = Date.now()) {
  const inicio = inicioDaSemana(instante);
  return {
    chave: chaveDaSemana(instante),
    inicio,
    fim: inicio + 7 * DIA_MS - 1000, // domingo 23:59:59
    fusoMinutos: FUSO_MINUTOS,
  };
}

// ============================================================================
// 2. A PONTUACAO
// ============================================================================
//
// A tabela abaixo e o unico lugar a mexer para mudar quanto vale cada posicao.
// A chave e a QUANTIDADE DE JOGADORES DAQUELA PARTIDA - vencer um duelo de dois
// nao pode valer o mesmo que vencer uma mesa cheia de quatro.
//
// O jogo aceita de 2 a 4 jogadores, entao 'padrao' hoje atende as mesas de 4.
// Ele fica como rede de seguranca: qualquer numero de jogadores sem tabela
// propria cai nele, e posicoes alem do fim da lista valem 0.

const TABELAS_DE_PONTOS = {
  2: [1, 0], //           1o -> 1 ponto,  2o -> 0
  3: [2, 1, 0], //        1o -> 2 pontos, 2o -> 1,  3o -> 0
  padrao: [5, 3, 2, 1], // 1o -> 5, 2o -> 3, 3o -> 2, 4o -> 1, demais -> 0
};

function pontosDaPosicao(posicao, totalDeJogadores) {
  const tabela = TABELAS_DE_PONTOS[totalDeJogadores] || TABELAS_DE_PONTOS.padrao;
  return tabela[posicao - 1] ?? 0;
}

// ============================================================================
// 3. AS POSICOES (e os empates)
// ============================================================================
//
// REGRA DE DESEMPATE ADOTADA: exatamente a mesma que o jogo ja usa para dizer
// quem ganhou (ver calcularResultado em gameState.js):
//   1o criterio - mais animais dentro do bar;
//   2o criterio - entre quem empatou, a MENOR soma de forcas dos animais que
//                 entraram (colocar bichos fracos no bar e mais dificil, entao
//                 vale mais).
// Nao usamos ordem de entrada na sala nem sorteio: a posicao sai do que
// aconteceu na mesa.
//
// EMPATE QUE SOBRA: se dois jogadores empatam nos DOIS criterios, eles dividem
// a mesma posicao e recebem os MESMOS pontos - e a posicao seguinte e pulada.
// Dois primeiros lugares numa mesa de quatro levam 5 pontos cada, e o proximo
// e o 3o lugar (2 pontos). E a contagem usada em esporte, e nao penaliza
// ninguem por um empate que o jogo nao conseguiu desfazer.

function posicionar(tabela) {
  let posicao = 0;
  let anterior = null;

  return tabela.map((linha, indice) => {
    const empatouComOAnterior =
      anterior && anterior.entraram === linha.entraram && anterior.somaForcas === linha.somaForcas;
    posicao = empatouComOAnterior ? posicao : indice + 1;
    anterior = linha;
    return { ...linha, posicao };
  });
}

// ============================================================================
// 4. REGISTRO DA PARTIDA
// ============================================================================
//
// Recebe o `resultado` que gameState.calcularResultado ja produziu. Nao
// recalcula nada de jogo - so traduz posicoes em pontos e grava.
//
// NAO CONTAR DUAS VEZES: o id da partida e a chave primaria da tabela
// `partidas`. Se o mesmo fim de partida chegar aqui de novo (dois jogadores
// terminando ao mesmo tempo, uma reconexao, um clique repetido), o INSERT OR
// IGNORE nao faz nada e devolvemos { novo: false }.

async function registrarPartida({ partidaId, sala, resultado, quando = Date.now() }) {
  if (!partidaId || !resultado || !Array.isArray(resultado.tabela)) {
    throw new Error('Partida sem identificação ou sem resultado.');
  }

  const semana = chaveDaSemana(quando);
  const classificados = posicionar(resultado.tabela);
  const total = classificados.length;

  // Uma transacao so: ou a partida inteira entra, ou nada entra.
  const linhas = await banco.transacao(async (tx) => {
    const partida = await tx.execute({
      sql: `INSERT OR IGNORE INTO partidas (id, sala, terminou_em, semana, jogadores)
            VALUES (?, ?, ?, ?, ?)`,
      args: [partidaId, sala || null, quando, semana, total],
    });

    if (partida.rowsAffected === 0) return null; // ja tinha sido registrada

    const gravadas = [];
    for (const jogador of classificados) {
      // Uma conta que nao existe mais no banco (apagada) nao pode virar linha:
      // a chave estrangeira recusaria e derrubaria a transacao inteira.
      const existe = await tx.execute({
        sql: 'SELECT 1 FROM usuarios WHERE id = ?',
        args: [jogador.id],
      });
      if (!existe.rows.length) continue;

      const pontos = pontosDaPosicao(jogador.posicao, total);
      await tx.execute({
        sql: `INSERT OR IGNORE INTO resultados
                (partida_id, usuario_id, posicao, animais, soma_forcas, pontos, semana, criado_em)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          partidaId,
          jogador.id,
          jogador.posicao,
          jogador.entraram,
          jogador.somaForcas,
          pontos,
          semana,
          quando,
        ],
      });
      gravadas.push({ ...jogador, pontos });
    }
    return gravadas;
  });

  return linhas ? { novo: true, semana, jogadores: linhas } : { novo: false, semana };
}

// ============================================================================
// 5. CONSULTA
// ============================================================================

// O ranking de uma semana. Ordem: mais pontos; empate em pontos vai para quem
// jogou menos partidas (aproveitou melhor cada uma); persistindo, ordem alfabetica.
async function rankingDaSemana(chave = chaveDaSemana(), limite = 100) {
  const linhas = await banco.tudo(
    `SELECT u.id, u.apelido AS nome,
              SUM(r.pontos)  AS pontos,
              COUNT(*)       AS partidas,
              SUM(CASE WHEN r.posicao = 1 THEN 1 ELSE 0 END) AS vitorias
         FROM resultados r
         JOIN usuarios  u ON u.id = r.usuario_id
        WHERE r.semana = ?
        GROUP BY u.id, u.apelido
        ORDER BY pontos DESC, partidas ASC, u.apelido COLLATE NOCASE ASC
        LIMIT ?`,
    [chave, limite]
  );
  return linhas.map((linha, indice) => ({ ...linha, posicao: indice + 1 }));
}

// Todas as semanas que ja tiveram partida, da mais recente para a mais antiga.
// Hoje a tela so mostra a semana atual, mas o historico ja esta aqui.
const semanasComPartidas = () =>
  banco.tudo(
    'SELECT semana, COUNT(*) AS partidas FROM partidas GROUP BY semana ORDER BY semana DESC'
  );

// AS MARCAS DE UMA PESSOA, para o painel do menu.
//
// Tres recortes, porque respondem perguntas diferentes: o total ("quanto eu ja
// joguei"), a semana ("como estou agora") e a melhor posicao ja alcancada ("do
// que eu sou capaz"). Sem nada disso, quem abre o jogo sozinho nao tem nenhum
// motivo para voltar - o ranking so fala de quem esta na frente.
async function estatisticasDe(usuarioId, chave = chaveDaSemana()) {
  const vazio = { partidas: 0, vitorias: 0, pontos: 0 };
  if (!usuarioId) return { total: vazio, semana: vazio, melhorPosicao: null, posicaoNaSemana: null };

  const contar = async (filtro, argumentos) =>
    (await banco.um(
      `SELECT COUNT(*) AS partidas,
              COALESCE(SUM(pontos), 0) AS pontos,
              COALESCE(SUM(CASE WHEN posicao = 1 THEN 1 ELSE 0 END), 0) AS vitorias
         FROM resultados
        WHERE usuario_id = ?${filtro}`,
      argumentos
    )) || vazio;

  const total = await contar('', [usuarioId]);
  const semana = await contar(' AND semana = ?', [usuarioId, chave]);
  const melhor = await banco.um('SELECT MIN(posicao) AS melhor FROM resultados WHERE usuario_id = ?', [
    usuarioId,
  ]);

  // A posicao desta semana sai da MESMA consulta que desenha o ranking, para as
  // duas telas nunca discordarem sobre em que lugar a pessoa esta.
  const tabela = await rankingDaSemana(chave);
  const minhaLinha = tabela.find((l) => l.id === usuarioId);

  return {
    total,
    semana,
    melhorPosicao: melhor && melhor.melhor ? melhor.melhor : null,
    posicaoNaSemana: minhaLinha ? minhaLinha.posicao : null,
    deQuantos: tabela.length,
  };
}

// As ultimas partidas de um jogador - materia-prima para uma futura tela de perfil.
const partidasDoUsuario = (usuarioId, limite = 20) =>
  banco.tudo(
    `SELECT r.*, p.terminou_em, p.jogadores
       FROM resultados r JOIN partidas p ON p.id = r.partida_id
      WHERE r.usuario_id = ?
      ORDER BY p.terminou_em DESC LIMIT ?`,
    [usuarioId, limite]
  );

module.exports = {
  TABELAS_DE_PONTOS,
  FUSO_MINUTOS,
  pontosDaPosicao,
  posicionar,
  inicioDaSemana,
  chaveDaSemana,
  semanaAtual,
  registrarPartida,
  rankingDaSemana,
  semanasComPartidas,
  estatisticasDe,
  partidasDoUsuario,
};
