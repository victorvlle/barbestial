// A unica porta de entrada para o banco de dados.
//
// POR QUE SQLITE (ainda): o jogo e um servidor Node de um processo so. SQLite
// da transacoes, chaves estrangeiras e GROUP BY - que e tudo o que o ranking
// precisa - sem nada de exotico. O que mudou foi ONDE o arquivo mora.
//
// POR QUE O BANCO SAIU DE DENTRO DO SERVIDOR: no plano gratuito do Render o
// disco e descartavel. Ele e apagado a cada deploy, a cada reinicio e a cada
// 15 minutos de hibernacao. Um arquivo local ali significa perder todas as
// contas o tempo todo. Agora o banco fica no Turso (SQLite hospedado): o
// servidor pode ser reiniciado, redeployado ou hibernar - os dados ficam.
//
// COMO ELE ESCOLHE ONDE SE CONECTAR, nesta ordem:
//   1. TURSO_URL (+ TURSO_TOKEN) -> o banco de verdade, na nuvem
//   2. BANCO_CAMINHO             -> um arquivo local, para desenvolver
//   3. data/barbestial.db        -> o padrao, se nada for dito
// Nos testes, BANCO_CAMINHO=':memory:' deixa tudo na memoria.
//
// POR QUE TUDO PASSA POR AQUI: nenhum outro arquivo conhece o cliente do
// banco. usuarios.js e ranking.js falam com as quatro funcoes daqui embaixo
// (um / tudo / rodar / varios). Se um dia o banco mudar de novo, muda so este
// arquivo.
//
// TUDO E ASSINCRONO. O banco agora esta do outro lado da rede, entao toda
// consulta devolve uma promessa. E por isso que as funcoes de usuarios.js e
// ranking.js viraram `async` - nao e enfeite.

const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');

const CAMINHO_PADRAO = path.join(__dirname, '..', '..', 'data', 'barbestial.db');

// Versao do formato do banco. Toda mudanca de estrutura vira um degrau novo em
// MIGRACOES, e este numero sobe junto.
const VERSAO_ATUAL = 3;

let db = null;

// Monta a configuracao de conexao a partir do ambiente.
function enderecoDoBanco() {
  const remoto = (process.env.TURSO_URL || '').trim();
  if (remoto) {
    return { url: remoto, authToken: (process.env.TURSO_TOKEN || '').trim() || undefined };
  }

  const caminho = process.env.BANCO_CAMINHO || CAMINHO_PADRAO;

  // BANCO EM MEMORIA (so nos testes). O ':memory:' cru NAO SERVE aqui, e o
  // motivo e sutil: uma transacao abre uma segunda conexao, e cada conexao
  // ':memory:' recebe um banco privado e VAZIO. O resultado e o banco inteiro
  // desaparecer no meio da suite ("no such table: usuarios"). Com
  // 'cache=shared' todas as conexoes do processo enxergam o mesmo banco.
  if (caminho === ':memory:') return { url: 'file::memory:?cache=shared' };

  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  return { url: `file:${caminho}` };
}

// Abre a conexao e deixa o banco na versao atual. Chamada uma vez, na subida do
// servidor: falhar aqui e melhor do que falhar no meio de uma partida.
async function abrir(config = enderecoDoBanco()) {
  if (db) return db;
  db = createClient(config);

  // Chave estrangeira e o que faz apagar uma conta levar junto os tokens dela.
  await db.execute('PRAGMA foreign_keys = ON');

  await migrar(db);
  return db;
}

// O cliente ja aberto. Quem chama isto sem ter aberto o banco tem um erro claro
// em vez de um `null` misterioso tres camadas adiante.
function cliente() {
  if (!db) throw new Error('o banco ainda nao foi aberto - chame abrir() na subida do servidor');
  return db;
}

// ============================================================================
// AS QUATRO FUNCOES QUE O RESTO DO CODIGO USA
// ============================================================================

// Uma linha, ou null. `SELECT ... WHERE id = ?`
async function um(sql, args = []) {
  const resposta = await cliente().execute({ sql, args });
  return resposta.rows[0] || null;
}

// Todas as linhas, sempre um array (vazio se nao houver nenhuma).
async function tudo(sql, args = []) {
  const resposta = await cliente().execute({ sql, args });
  return resposta.rows;
}

// INSERT / UPDATE / DELETE. Devolve o resultado bruto (rowsAffected).
function rodar(sql, args = []) {
  return cliente().execute({ sql, args });
}

// Varios comandos de uma vez, separados por `;`. So para estrutura (CREATE
// TABLE, CREATE INDEX) - nao aceita parametros, entao nunca receba dado de
// usuario aqui.
function varios(sql) {
  return cliente().executeMultiple(sql);
}

// Um bloco que grava tudo ou nada. Use quando duas escritas precisam acontecer
// juntas (registrar a partida e os resultados dela, por exemplo).
async function transacao(acao) {
  const tx = await cliente().transaction('write');
  try {
    const saida = await acao(tx);
    await tx.commit();
    return saida;
  } catch (erro) {
    await tx.rollback().catch(() => {}); // o erro que importa e o de cima
    throw erro;
  }
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
  async (banco) => {
    await banco.executeMultiple(`
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
  // Aqui senha e login externo passaram a ser OPCIONAIS, desde que existisse ao
  // menos um dos dois, e entrou a coluna email_chave.
  //
  // Cabem dois formatos antigos:
  //   (a) o primeiro de todos, com as colunas provedor/provedor_id/nome
  //   (b) o segundo, que exigia apelido+senha+login externo juntos
  // Os dois viram o formato novo SEM PERDER NENHUMA LINHA.
  async (banco) => {
    const colunas = (await banco.execute('PRAGMA table_info(usuarios)')).rows.map((c) => c.name);
    const formatoOriginal = colunas.includes('provedor');

    await banco.executeMultiple(`
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
      // Formato (a): provedor 'local' guardava a senha; o outro guardava o id
      // externo. Cada um vira uma conta com a credencial que de fato tinha.
      await banco.executeMultiple(`
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
      await banco.executeMultiple(`
        INSERT INTO usuarios_novo
          (id, apelido, apelido_chave, senha_hash, senha_sal, google_sub, google_email,
           email_chave, avatar, criado_em, visto_em, senha_trocada_em)
        SELECT
          id, apelido, apelido_chave, senha_hash, senha_sal, google_sub, google_email,
          LOWER(google_email), NULL, criado_em, visto_em, senha_trocada_em
        FROM usuarios;
      `);
    }

    const antes = (await banco.execute('SELECT COUNT(*) AS n FROM usuarios')).rows[0].n;
    const depois = (await banco.execute('SELECT COUNT(*) AS n FROM usuarios_novo')).rows[0].n;

    await banco.executeMultiple('DROP TABLE usuarios; ALTER TABLE usuarios_novo RENAME TO usuarios;');
    await banco.executeMultiple('CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios (email_chave);');

    if (antes !== depois) {
      console.warn(`[banco] migração 1->2: ${antes} contas antes, ${depois} depois.`);
    }
  },

  // --------------------------------------------------------------- 2 -> 3
  // Sai o login externo, entra o e-mail proprio:
  //   * `email` + `email_chave` (minusculas, unica)
  //   * `email_verificado_em` - guardado para o futuro; hoje o cadastro nao
  //     depende de confirmacao para a pessoa jogar nem para pontuar
  //   * some google_sub e avatar
  //   * nasce a tabela `tokens`, dos links de uso unico
  //
  // O QUE ACONTECE COM QUEM JA TEM CONTA:
  //   - quem entrou por apelido+senha mantem tudo; o e-mail fica em branco e
  //     pode ser preenchido depois
  //   - quem tinha entrado por login externo fica sem senha, mas com o e-mail
  //     preenchido; o administrador define uma senha nova quando a pessoa pedir
  //   - ninguem e apagado, e por isso o historico de partidas continua inteiro
  //     (apagar um usuario derrubaria os resultados dele em cascata)
  async (banco) => {
    await banco.executeMultiple(`
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
        CASE WHEN google_email IS NOT NULL THEN criado_em ELSE NULL END,
        senha_hash, senha_sal, criado_em, visto_em, senha_trocada_em
      FROM usuarios;
    `);

    await banco.executeMultiple('DROP TABLE usuarios; ALTER TABLE usuarios_novo RENAME TO usuarios;');
    await banco.executeMultiple('CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios (email_chave);');

    // Links de uso unico. Guardamos o HASH do token, nunca o token: se o banco
    // vazar, o que estiver la dentro nao abre nada.
    await banco.executeMultiple(`
      CREATE TABLE IF NOT EXISTS tokens (
        hash       TEXT PRIMARY KEY,
        usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        tipo       TEXT NOT NULL,
        expira_em  INTEGER NOT NULL,
        usado_em   INTEGER,
        criado_em  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tokens_usuario ON tokens (usuario_id, tipo);
    `);
  },
];

async function migrar(banco) {
  const versao = (await banco.execute('PRAGMA user_version')).rows[0].user_version;

  // Bancos que existem desde antes deste sistema de versao aparecem como 0 mas
  // ja tem as tabelas. Reconhecemos isso pela presenca da tabela de usuarios: o
  // degrau 0->1 usa CREATE TABLE IF NOT EXISTS, entao rodar nele e inofensivo.
  for (let degrau = versao; degrau < VERSAO_ATUAL; degrau++) {
    // De proposito FORA de uma transacao: o SQLite nao permite mexer em
    // user_version dentro de uma, e varios degraus fazem DDL (CREATE/DROP),
    // que ja e atomico por comando. Se um degrau falhar no meio, o servidor nao
    // sobe e o log diz qual foi - nenhum degrau seguinte roda por cima.
    await MIGRACOES[degrau](banco);
    await banco.execute(`PRAGMA user_version = ${degrau + 1}`);
    console.log(`[banco] migração aplicada: ${degrau} -> ${degrau + 1}`);
  }
}

// Fechar so importa nos testes, para o processo poder terminar limpo.
function fechar() {
  if (db) db.close();
  db = null;
}

module.exports = {
  abrir,
  fechar,
  migrar,
  cliente,
  um,
  tudo,
  rodar,
  varios,
  transacao,
  enderecoDoBanco,
  CAMINHO_PADRAO,
  VERSAO_ATUAL,
};
