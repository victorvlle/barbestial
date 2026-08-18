// A unica porta de entrada para o banco de dados.
//
// POR QUE SQLITE: o jogo ja e um servidor Node de um processo so. SQLite e um
// arquivo do lado do servidor - sem outro servico para subir, sem senha de
// banco, sem rede no meio. Continua sendo "banco de verdade": transacoes,
// chaves estrangeiras e consultas com GROUP BY, que e o que o ranking precisa.
//
// POR QUE TUDO PASSA POR AQUI: nenhum outro arquivo faz `require('better-sqlite3')`.
// Se um dia o ranking crescer a ponto de pedir Postgres, e este arquivo que
// muda - usuarios.js e ranking.js continuam iguais.
//
// ONDE O ARQUIVO FICA: por padrao em data/barbestial.db, ao lado do codigo.
// Em producao o caminho vem de BANCO_CAMINHO, apontando para um disco que
// sobrevive a reinicios (ver render.yaml). Sem isso, o Render apaga o arquivo
// a cada deploy e o ranking comeca do zero.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const CAMINHO_PADRAO = path.join(__dirname, '..', '..', 'data', 'barbestial.db');

let db = null;

// ':memory:' existe para os testes: banco descartavel, sem tocar em disco.
function abrir(caminho = process.env.BANCO_CAMINHO || CAMINHO_PADRAO) {
  if (db) return db;

  if (caminho !== ':memory:') fs.mkdirSync(path.dirname(caminho), { recursive: true });
  db = new Database(caminho);

  // WAL: leituras (o ranking) nao ficam esperando escritas (o fim de partida).
  if (caminho !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  recriarSeForOEsquemaAntigo(db);
  criarEsquema(db);
  return db;
}

// ---------------------------------------------------------------- migracao
//
// A primeira versao das contas permitia entrar SO pelo Google ou SO por senha
// (havia uma coluna 'provedor'). Agora as tres coisas - apelido, senha e conta
// do Google - sao obrigatorias juntas, porque e o Google que serve de prova de
// identidade na hora de recuperar a senha.
//
// As contas antigas nao tem como ser convertidas: falta justamente o dado que
// virou obrigatorio. Por isso, ao encontrar o formato antigo, comecamos limpo.
// Isso foi combinado enquanto o jogo ainda estava em fase de testes.
//
// A checagem e pelo FORMATO, nao por uma data ou um contador: rodar duas vezes
// nao apaga nada na segunda, porque na segunda o formato antigo ja nao existe.
function recriarSeForOEsquemaAntigo(banco) {
  const existe = banco
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='usuarios'")
    .get();
  if (!existe) return;

  const colunas = banco.prepare('PRAGMA table_info(usuarios)').all().map((c) => c.name);
  if (!colunas.includes('provedor')) return; // ja esta no formato novo

  console.warn(
    '[banco] contas no formato antigo encontradas. Recriando do zero: ' +
      'agora apelido, senha e Google são obrigatórios juntos e as contas ' +
      'antigas não têm conta do Google conectada.'
  );

  banco.exec(`
    DROP TABLE IF EXISTS resultados;
    DROP TABLE IF EXISTS partidas;
    DROP TABLE IF EXISTS usuarios;
  `);
}

// ---------------------------------------------------------------- esquema
//
// Tudo com IF NOT EXISTS: subir o servidor de novo nao quebra nada, e um banco
// que ja existe so ganha o que estiver faltando.

function criarEsquema(banco) {
  banco.exec(`
    -- Uma linha por conta. As TRES formas de identificacao sao obrigatorias
    -- (NOT NULL) e cada uma tem um papel diferente:
    --
    --   apelido    -> o login do dia a dia e o nome que aparece no ranking
    --   senha      -> guardada como scrypt(senha, sal); a senha em si nao existe
    --   google_sub -> o identificador permanente da conta Google
    --
    -- POR QUE O GOOGLE E OBRIGATORIO: ele e a UNICA prova aceita para recuperar
    -- a senha. Saber o apelido de alguem nao da acesso a nada - e preciso
    -- entrar na conta do Google daquela pessoa. Sem isso, "esqueci a senha"
    -- viraria uma porta destrancada para quem conhecesse o apelido.
    --
    -- apelido_chave e o apelido em minusculas: e nele que a unicidade e a busca
    -- acontecem, para "Victor" e "victor" nao virarem duas contas.
    CREATE TABLE IF NOT EXISTS usuarios (
      id             TEXT PRIMARY KEY,
      apelido        TEXT NOT NULL,
      apelido_chave  TEXT NOT NULL UNIQUE,
      senha_hash     TEXT NOT NULL,
      senha_sal      TEXT NOT NULL,
      google_sub     TEXT NOT NULL UNIQUE,
      google_email   TEXT,
      criado_em      INTEGER NOT NULL,
      visto_em       INTEGER NOT NULL,
      senha_trocada_em INTEGER
    );

    -- Uma linha por partida CONCLUIDA. O id e o partidaId que o proprio jogo ja
    -- gera (ver gameState.js) - e por isso que registrar duas vezes a mesma
    -- partida e impossivel: a chave primaria recusa a segunda.
    CREATE TABLE IF NOT EXISTS partidas (
      id          TEXT PRIMARY KEY,
      sala        TEXT,
      terminou_em INTEGER NOT NULL,
      semana      TEXT NOT NULL,
      jogadores   INTEGER NOT NULL
    );

    -- Uma linha por jogador em cada partida. Guardamos tambem os numeros que
    -- decidiram a posicao (animais no bar e soma das forcas) para que um dia
    -- de para conferir um ranking antigo sem precisar recalcular nada.
    CREATE TABLE IF NOT EXISTS resultados (
      partida_id  TEXT NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
      usuario_id  TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      posicao     INTEGER NOT NULL,
      animais     INTEGER NOT NULL,
      soma_forcas INTEGER NOT NULL,
      pontos      INTEGER NOT NULL,
      semana      TEXT NOT NULL,
      criado_em   INTEGER NOT NULL,
      PRIMARY KEY (partida_id, usuario_id)
    );

    -- O ranking sempre filtra por semana: e este indice que faz a consulta ser
    -- instantanea mesmo depois de um ano de partidas guardadas.
    CREATE INDEX IF NOT EXISTS idx_resultados_semana ON resultados (semana);
    CREATE INDEX IF NOT EXISTS idx_resultados_usuario ON resultados (usuario_id);
  `);
}

// Fechar so importa nos testes, para o processo poder terminar limpo.
function fechar() {
  if (db) db.close();
  db = null;
}

module.exports = { abrir, fechar, CAMINHO_PADRAO };
