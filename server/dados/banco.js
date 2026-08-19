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
// sobrevive a reinicios (ver render.yaml).

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const CAMINHO_PADRAO = path.join(__dirname, '..', '..', 'data', 'barbestial.db');

// Versao do formato do banco. Toda mudanca de estrutura vira um degrau novo em
// MIGRACOES, e este numero sobe junto.
const VERSAO_ATUAL = 3;

let db = null;

// ':memory:' existe para os testes: banco descartavel, sem tocar em disco.
function abrir(caminho = process.env.BANCO_CAMINHO || CAMINHO_PADRAO) {
  if (db) return db;

  if (caminho !== ':memory:') fs.mkdirSync(path.dirname(caminho), { recursive: true });
  db = new Database(caminho);

  // WAL: leituras (o ranking) nao ficam esperando escritas (o fim de partida).
  if (caminho !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  migrar(db);
  return db;
}

// ============================================================================
// MIGRACOES
// ============================================================================
//
// COMO FUNCIONA: o SQLite guarda um numero inteiro por banco (PRAGMA
// user_version). Cada degrau abaixo leva de uma versao para a seguinte, e so
// roda se o banco ainda nao passou por ele. Subir o servidor duas vezes nao
// executa nada duas vezes.
//
// REGRA DESTE ARQUIVO: migracao NAO APAGA CONTA DE NINGUEM. Quando uma coluna
// precisa mudar de regra (o SQLite nao sabe "ALTER COLUMN"), a tabela e
// reconstruida COPIANDO as linhas antigas para a nova. Partidas e ranking
// seguem intactos junto.
//
// Bancos criados do zero tambem passam por aqui: o degrau 0->1 cria as tabelas
// e os seguintes as ajustam. Um caminho so, sempre exercitado.

const MIGRACOES = [
  // --------------------------------------------------------------- 0 -> 1
  // Estrutura inicial: contas, partidas e resultados.
  (banco) => {
    banco.exec(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id             TEXT PRIMARY KEY,
        apelido        TEXT NOT NULL,
        apelido_chave  TEXT NOT NULL UNIQUE,
        senha_hash     TEXT,
        senha_sal      TEXT,
        google_sub     TEXT UNIQUE,
        google_email   TEXT,
        criado_em      INTEGER NOT NULL,
        visto_em       INTEGER NOT NULL,
        senha_trocada_em INTEGER
      );

      -- Uma linha por partida CONCLUIDA. O id e o partidaId que o proprio jogo
      -- ja gera (ver gameState.js) - e por isso que registrar duas vezes a
      -- mesma partida e impossivel: a chave primaria recusa a segunda.
      CREATE TABLE IF NOT EXISTS partidas (
        id          TEXT PRIMARY KEY,
        sala        TEXT,
        terminou_em INTEGER NOT NULL,
        semana      TEXT NOT NULL,
        jogadores   INTEGER NOT NULL
      );

      -- Uma linha por jogador em cada partida. Guardamos tambem os numeros que
      -- decidiram a posicao (animais no bar e soma das forcas) para que um dia
      -- de para conferir um ranking antigo sem recalcular nada.
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

      -- O ranking sempre filtra por semana: e este indice que faz a consulta
      -- ser instantanea mesmo depois de um ano de partidas guardadas.
      CREATE INDEX IF NOT EXISTS idx_resultados_semana ON resultados (semana);
      CREATE INDEX IF NOT EXISTS idx_resultados_usuario ON resultados (usuario_id);
    `);
  },

  // --------------------------------------------------------------- 1 -> 2
  // Google Login de verdade:
  //   * senha e Google passam a ser OPCIONAIS, desde que exista ao menos um dos
  //     dois. Isso permite conta so com senha (quem prefere) e conta criada
  //     sozinha no primeiro "Continuar com Google" (quem nao quer senha).
  //   * email_chave: o e-mail em minusculas, usado para NAO criar conta
  //     duplicada quando a mesma pessoa aparece pelo Google.
  //   * avatar: a foto do perfil do Google.
  //
  // Aqui cabem dois formatos antigos:
  //   (a) o primeiro de todos, com as colunas provedor/provedor_id/nome
  //   (b) o segundo, que exigia apelido+senha+Google juntos
  // Os dois viram o formato novo SEM PERDER NENHUMA LINHA.
  (banco) => {
    const colunas = banco.prepare('PRAGMA table_info(usuarios)').all().map((c) => c.name);
    const formatoOriginal = colunas.includes('provedor');

    banco.exec(`
      CREATE TABLE usuarios_novo (
        id             TEXT PRIMARY KEY,
        apelido        TEXT NOT NULL,
        apelido_chave  TEXT NOT NULL UNIQUE,
        senha_hash     TEXT,
        senha_sal      TEXT,
        google_sub     TEXT UNIQUE,
        google_email   TEXT,
        email_chave    TEXT UNIQUE,
        avatar         TEXT,
        criado_em      INTEGER NOT NULL,
        visto_em       INTEGER NOT NULL,
        senha_trocada_em INTEGER,
        -- A trava que substitui os NOT NULL: uma conta precisa de PELO MENOS
        -- uma forma de provar quem e. Sem isso existiria conta sem entrada.
        CHECK (senha_hash IS NOT NULL OR google_sub IS NOT NULL)
      );
    `);

    if (formatoOriginal) {
      // Formato (a): provedor 'local' guardava a senha; 'google' guardava o sub.
      // Cada um vira uma conta com a credencial que ela de fato tinha.
      banco.exec(`
        INSERT INTO usuarios_novo
          (id, apelido, apelido_chave, senha_hash, senha_sal, google_sub, google_email,
           email_chave, avatar, criado_em, visto_em, senha_trocada_em)
        SELECT
          id,
          nome,
          LOWER(nome),
          CASE WHEN provedor = 'local'  THEN senha_hash  ELSE NULL END,
          CASE WHEN provedor = 'local'  THEN senha_sal   ELSE NULL END,
          CASE WHEN provedor = 'google' THEN provedor_id ELSE NULL END,
          NULL, NULL, NULL,
          criado_em, visto_em, NULL
        FROM usuarios
        WHERE (provedor = 'local' AND senha_hash IS NOT NULL) OR provedor = 'google';
      `);
    } else {
      // Formato (b): as colunas ja tem os nomes certos; so ganham as novas.
      banco.exec(`
        INSERT INTO usuarios_novo
          (id, apelido, apelido_chave, senha_hash, senha_sal, google_sub, google_email,
           email_chave, avatar, criado_em, visto_em, senha_trocada_em)
        SELECT
          id, apelido, apelido_chave, senha_hash, senha_sal, google_sub, google_email,
          LOWER(google_email), NULL, criado_em, visto_em, senha_trocada_em
        FROM usuarios;
      `);
    }

    const antes = banco.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;
    const depois = banco.prepare('SELECT COUNT(*) AS n FROM usuarios_novo').get().n;

    banco.exec('DROP TABLE usuarios; ALTER TABLE usuarios_novo RENAME TO usuarios;');
    banco.exec('CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios (email_chave);');

    if (antes !== depois) {
      console.warn(`[banco] migração 1->2: ${antes} contas antes, ${depois} depois.`);
    }
  },

  // --------------------------------------------------------------- 2 -> 3
  // Sai o login com Google, entra o e-mail proprio:
  //   * `email` + `email_chave` (minusculas, unica) - a identidade verificavel
  //   * `email_verificado_em` - nulo enquanto a pessoa nao clicar no link
  //   * some google_sub e avatar
  //   * nasce a tabela `tokens`, dos links de uso unico
  //
  // O QUE ACONTECE COM QUEM JA TEM CONTA:
  //   - quem entrou por apelido+senha mantem tudo; o e-mail fica em branco e
  //     ela pode preencher depois
  //   - quem tinha entrado pelo Google fica SEM senha, mas COM o e-mail do
  //     Google preenchido: e so pedir "esqueci minha senha" e definir uma
  //   - ninguem e apagado, e por isso o historico de partidas continua inteiro
  //     (apagar um usuario derrubaria os resultados dele em cascata)
  (banco) => {
    banco.exec(`
      CREATE TABLE usuarios_novo (
        id             TEXT PRIMARY KEY,
        apelido        TEXT NOT NULL,
        apelido_chave  TEXT NOT NULL UNIQUE,
        email          TEXT,
        email_chave    TEXT UNIQUE,
        email_verificado_em INTEGER,
        senha_hash     TEXT,
        senha_sal      TEXT,
        criado_em      INTEGER NOT NULL,
        visto_em       INTEGER NOT NULL,
        senha_trocada_em INTEGER
      );

      INSERT INTO usuarios_novo
        (id, apelido, apelido_chave, email, email_chave, email_verificado_em,
         senha_hash, senha_sal, criado_em, visto_em, senha_trocada_em)
      SELECT
        id, apelido, apelido_chave,
        google_email,
        email_chave,
        -- O Google ja tinha confirmado esses e-mails; nao faz sentido pedir de novo.
        CASE WHEN google_email IS NOT NULL THEN criado_em ELSE NULL END,
        senha_hash, senha_sal, criado_em, visto_em, senha_trocada_em
      FROM usuarios;
    `);

    banco.exec('DROP TABLE usuarios; ALTER TABLE usuarios_novo RENAME TO usuarios;');
    banco.exec('CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios (email_chave);');

    // Links de uso unico (confirmar e-mail, redefinir senha).
    //
    // Guardamos o HASH do token, nunca o token. E a mesma logica da senha: se o
    // banco vazar, os links que estiverem la dentro nao servem para nada, porque
    // o que chega pelo e-mail e o valor original.
    banco.exec(`
      CREATE TABLE IF NOT EXISTS tokens (
        hash       TEXT PRIMARY KEY,
        usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        tipo       TEXT NOT NULL,   -- 'verificar' | 'recuperar'
        expira_em  INTEGER NOT NULL,
        usado_em   INTEGER,
        criado_em  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tokens_usuario ON tokens (usuario_id, tipo);
    `);
  },
];

function migrar(banco) {
  const versao = banco.pragma('user_version', { simple: true });

  // Bancos que existem desde antes deste sistema de versao aparecem como 0 mas
  // ja tem as tabelas. Reconhecemos isso pela presenca da tabela de usuarios: o
  // degrau 0->1 usa CREATE TABLE IF NOT EXISTS, entao rodar nele e inofensivo.
  for (let degrau = versao; degrau < VERSAO_ATUAL; degrau++) {
    const aplicar = banco.transaction(() => {
      MIGRACOES[degrau](banco);
      banco.pragma(`user_version = ${degrau + 1}`);
    });
    aplicar();
    console.log(`[banco] migração aplicada: ${degrau} -> ${degrau + 1}`);
  }
}

// Fechar so importa nos testes, para o processo poder terminar limpo.
function fechar() {
  if (db) db.close();
  db = null;
}

module.exports = { abrir, fechar, migrar, CAMINHO_PADRAO, VERSAO_ATUAL };
