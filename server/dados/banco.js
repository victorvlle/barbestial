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

  criarEsquema(db);
  return db;
}

// ---------------------------------------------------------------- esquema
//
// Tudo com IF NOT EXISTS: subir o servidor de novo nao quebra nada, e um banco
// que ja existe so ganha o que estiver faltando.

function criarEsquema(banco) {
  banco.exec(`
    -- Uma linha por conta. 'provedor' diz de onde ela veio:
    --   'google' -> provedor_id e o "sub" que o Google devolve (nunca muda)
    --   'local'  -> provedor_id e o apelido em minusculas, e a senha fica aqui
    CREATE TABLE IF NOT EXISTS usuarios (
      id          TEXT PRIMARY KEY,
      provedor    TEXT NOT NULL,
      provedor_id TEXT NOT NULL,
      nome        TEXT NOT NULL,
      senha_hash  TEXT,
      senha_sal   TEXT,
      criado_em   INTEGER NOT NULL,
      visto_em    INTEGER NOT NULL,
      UNIQUE (provedor, provedor_id)
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
