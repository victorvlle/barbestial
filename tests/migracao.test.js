// Migrações: a promessa é uma só - NINGUÉM PERDE A CONTA.
// Rode com: npm test
//
// Cada teste monta um banco no formato ANTIGO, roda a migração e confere que as
// linhas continuam lá, com a credencial certa. Como o banco é um arquivo, dá
// para simular exatamente o que vai acontecer no servidor de produção.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createClient } = require('@libsql/client');

const { migrar, VERSAO_ATUAL } = require('../server/dados/banco');

// Um ARQUIVO descartável por teste - de propósito, e não um banco de memória:
// a migração precisa se comportar como no servidor de verdade.
let contador = 0;
function bancoTemporario() {
  const caminho = path.join(os.tmpdir(), `bb-migra-${process.pid}-${++contador}.db`);
  const banco = createClient({ url: `file:${caminho}` });
  return {
    banco,
    apagar: () => {
      banco.close();
      for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(caminho + sufixo, { force: true });
    },
  };
}

// Atalhos, para os testes lerem como antes.
const uma = async (banco, sql, args = []) => (await banco.execute({ sql, args })).rows[0] || null;
const todas = async (banco, sql, args = []) => (await banco.execute({ sql, args })).rows;

// ------------------------------------------------ formato 1: provedor/nome
// A primeira versão: uma conta era OU 'local' (apelido+senha) OU 'google'.
async function montarFormatoOriginal(banco) {
  await banco.executeMultiple(`
    CREATE TABLE usuarios (
      id TEXT PRIMARY KEY, provedor TEXT NOT NULL, provedor_id TEXT NOT NULL,
      nome TEXT NOT NULL, senha_hash TEXT, senha_sal TEXT,
      criado_em INTEGER NOT NULL, visto_em INTEGER NOT NULL,
      UNIQUE (provedor, provedor_id)
    );
    CREATE TABLE partidas (
      id TEXT PRIMARY KEY, sala TEXT, terminou_em INTEGER NOT NULL,
      semana TEXT NOT NULL, jogadores INTEGER NOT NULL
    );
    CREATE TABLE resultados (
      partida_id TEXT NOT NULL, usuario_id TEXT NOT NULL, posicao INTEGER NOT NULL,
      animais INTEGER NOT NULL, soma_forcas INTEGER NOT NULL, pontos INTEGER NOT NULL,
      semana TEXT NOT NULL, criado_em INTEGER NOT NULL,
      PRIMARY KEY (partida_id, usuario_id)
    );
    INSERT INTO usuarios VALUES
      ('u1','local','victor','Victor','hash-do-victor','sal1',1000,2000),
      ('u2','local','jorge','Jorge','hash-do-jorge','sal2',1001,2001),
      ('u3','google','sub-do-google-999','Maria',NULL,NULL,1002,2002);
    INSERT INTO partidas VALUES ('p1','AB12',3000,'2026-S32',3);
    INSERT INTO resultados VALUES
      ('p1','u1',1,4,20,2,'2026-S32',3000),
      ('p1','u2',2,2,10,1,'2026-S32',3000),
      ('p1','u3',3,1,5,0,'2026-S32',3000);
  `);
}

// ------------------------------------------ formato 2: os três obrigatórios
async function montarFormatoEstrito(banco) {
  await banco.executeMultiple(`
    CREATE TABLE usuarios (
      id TEXT PRIMARY KEY, apelido TEXT NOT NULL, apelido_chave TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL, senha_sal TEXT NOT NULL,
      google_sub TEXT NOT NULL UNIQUE, google_email TEXT,
      criado_em INTEGER NOT NULL, visto_em INTEGER NOT NULL, senha_trocada_em INTEGER
    );
    CREATE TABLE partidas (
      id TEXT PRIMARY KEY, sala TEXT, terminou_em INTEGER NOT NULL,
      semana TEXT NOT NULL, jogadores INTEGER NOT NULL
    );
    CREATE TABLE resultados (
      partida_id TEXT NOT NULL, usuario_id TEXT NOT NULL, posicao INTEGER NOT NULL,
      animais INTEGER NOT NULL, soma_forcas INTEGER NOT NULL, pontos INTEGER NOT NULL,
      semana TEXT NOT NULL, criado_em INTEGER NOT NULL,
      PRIMARY KEY (partida_id, usuario_id)
    );
    INSERT INTO usuarios VALUES
      ('a1','Victor','victor','hash1','sal1','sub1','victor@gmail.com',1000,2000,NULL),
      ('a2','Jorge','jorge','hash2','sal2','sub2','jorge@gmail.com',1001,2001,1500);
    INSERT INTO partidas VALUES ('p9','ZZ99',4000,'2026-S33',2);
    INSERT INTO resultados VALUES
      ('p9','a1',1,3,15,1,'2026-S33',4000),
      ('p9','a2',2,1,4,0,'2026-S33',4000);
  `);
}

// ============================================================ banco novo

test('banco novo nasce já na versão atual e com as tabelas certas', async () => {
  const { banco, apagar } = bancoTemporario();
  try {
    await migrar(banco);
    assert.strictEqual((await uma(banco, 'SELECT versao FROM esquema')).versao, VERSAO_ATUAL);

    const tabelas = (await todas(banco, "SELECT name FROM sqlite_master WHERE type='table'")).map(
      (t) => t.name
    );
    for (const esperada of ['usuarios', 'partidas', 'resultados']) {
      assert.ok(tabelas.includes(esperada), `falta a tabela ${esperada}`);
    }

    const colunas = (await todas(banco, 'PRAGMA table_info(usuarios)')).map((c) => c.name);
    for (const coluna of ['email', 'email_chave', 'email_verificado_em', 'senha_hash', 'senha_sal']) {
      assert.ok(colunas.includes(coluna), `falta a coluna ${coluna}`);
    }
    // O Google saiu de cena: as colunas dele não podem sobrar.
    for (const sumiu of ['google_sub', 'avatar']) {
      assert.ok(!colunas.includes(sumiu), `a coluna ${sumiu} deveria ter sumido`);
    }
    assert.ok(tabelas.includes('tokens'), 'a tabela de tokens precisa existir');
  } finally {
    apagar();
  }
});

test('rodar a migração de novo não faz nada (é seguro reiniciar o servidor)', async () => {
  const { banco, apagar } = bancoTemporario();
  try {
    await migrar(banco);
    await migrar(banco);
    await migrar(banco);
    assert.strictEqual((await uma(banco, 'SELECT versao FROM esquema')).versao, VERSAO_ATUAL);
  } finally {
    apagar();
  }
});

// ============================================= formato original preservado

test('formato original: as 3 contas sobrevivem, cada uma com a credencial que tinha', async () => {
  const { banco, apagar } = bancoTemporario();
  try {
    await montarFormatoOriginal(banco);
    await migrar(banco);

    const contas = await todas(banco, 'SELECT * FROM usuarios ORDER BY id');
    assert.strictEqual(contas.length, 3, 'nenhuma conta pode sumir');

    const [victor, jorge, maria] = contas;
    assert.strictEqual(victor.apelido, 'Victor');
    assert.strictEqual(victor.senha_hash, 'hash-do-victor', 'a senha antiga continua valendo');
    assert.strictEqual(victor.email, null, 'ele nunca deu um e-mail');
    assert.strictEqual(victor.email_verificado_em, null, 'e por isso nada foi confirmado');

    assert.strictEqual(jorge.apelido, 'Jorge');
    assert.strictEqual(jorge.senha_hash, 'hash-do-jorge');

    assert.strictEqual(maria.apelido, 'Maria');
    // Ela tinha entrado pelo Google e nunca teve senha. Continua no banco (o
    // histórico de partidas dela depende disso) e recupera o acesso pelo
    // "esqueci minha senha" assim que tiver um e-mail.
    assert.strictEqual(maria.senha_hash, null);
  } finally {
    apagar();
  }
});

test('formato original: partidas e pontos do ranking continuam intactos', async () => {
  const { banco, apagar } = bancoTemporario();
  try {
    await montarFormatoOriginal(banco);
    await migrar(banco);

    assert.strictEqual((await uma(banco, 'SELECT COUNT(*) AS n FROM partidas')).n, 1);
    assert.strictEqual((await uma(banco, 'SELECT COUNT(*) AS n FROM resultados')).n, 3);

    // O ranking daquela semana continua batendo com quem jogou.
    const tabela = await todas(
      banco,
      `SELECT u.apelido, SUM(r.pontos) AS pontos
         FROM resultados r JOIN usuarios u ON u.id = r.usuario_id
        WHERE r.semana = '2026-S32' GROUP BY u.id ORDER BY pontos DESC`
    );
    assert.deepStrictEqual(
      tabela.map((l) => [l.apelido, l.pontos]),
      [['Victor', 2], ['Jorge', 1], ['Maria', 0]]
    );
  } finally {
    apagar();
  }
});

// ============================================== formato estrito preservado

test('formato estrito: as contas continuam, agora com espaço para e-mail', async () => {
  const { banco, apagar } = bancoTemporario();
  try {
    await montarFormatoEstrito(banco);
    await migrar(banco);

    const contas = await todas(banco, 'SELECT * FROM usuarios ORDER BY id');
    assert.strictEqual(contas.length, 2);

    const victor = contas[0];
    assert.strictEqual(victor.apelido, 'Victor');
    assert.strictEqual(victor.senha_hash, 'hash1');
    // O e-mail que vinha do Google vira o e-mail da conta, e já nasce
    // confirmado: o Google tinha acabado de confirmá-lo.
    assert.strictEqual(victor.email, 'victor@gmail.com');
    assert.strictEqual(victor.email_chave, 'victor@gmail.com');
    assert.ok(victor.email_verificado_em, 'não faz sentido pedir confirmação de novo');
    assert.strictEqual(contas[1].senha_trocada_em, 1500, 'os carimbos de data seguem iguais');

    assert.strictEqual((await uma(banco, 'SELECT COUNT(*) AS n FROM resultados')).n, 2);
  } finally {
    apagar();
  }
});

// ================================================= a marcacao de versao
//
// A versao morava no PRAGMA user_version. O Turso remoto RECUSA escrever
// pragma - o servidor nem subia ("SQL not allowed statement"). Passou a morar
// numa tabela; estes testes garantem que os bancos marcados do jeito antigo
// continuam sendo reconhecidos, senao a migracao rodaria tudo de novo por cima
// de dados que ja estao no formato certo.

test('banco marcado do jeito antigo (user_version) é reconhecido, e nada roda duas vezes', async () => {
  const { banco, apagar } = bancoTemporario();
  try {
    // Um banco já pronto, com uma conta dentro...
    await migrar(banco);
    await banco.execute(
      `INSERT INTO usuarios (id, apelido, apelido_chave, email, email_chave, criado_em, visto_em)
       VALUES ('v','Victor','victor','victor@exemplo.test','victor@exemplo.test',1000,2000)`
    );

    // ...marcado como a versão ANTERIOR do jogo marcava: pragma, sem a tabela.
    await banco.execute('DROP TABLE esquema');
    await banco.execute(`PRAGMA user_version = ${VERSAO_ATUAL}`);

    // Se a marcação antiga fosse ignorada, a migração recomeçaria do zero e
    // tentaria reconstruir `usuarios` a partir de colunas que não existem mais.
    await migrar(banco);

    const contas = await todas(banco, 'SELECT * FROM usuarios');
    assert.strictEqual(contas.length, 1, 'a conta continua lá');
    assert.strictEqual(contas[0].email, 'victor@exemplo.test');
    assert.strictEqual(
      (await uma(banco, 'SELECT versao FROM esquema')).versao,
      VERSAO_ATUAL,
      'e a marcação passou para a tabela, sem precisar do pragma'
    );
  } finally {
    apagar();
  }
});

test('a migração NÃO escreve pragma - é o que quebrava no Turso', async () => {
  // O erro real de produção: "SQL not allowed statement: PRAGMA user_version = 1".
  // Aqui um banco de mentira recusa qualquer escrita de pragma, igual ao Turso,
  // e a migração precisa passar assim mesmo.
  const { banco, apagar } = bancoTemporario();
  const recusadas = [];
  const executarDeVerdade = banco.execute.bind(banco);
  banco.execute = (comando) => {
    const sql = typeof comando === 'string' ? comando : comando.sql;
    if (/^\s*PRAGMA\s+\w+\s*=/i.test(sql)) {
      recusadas.push(sql);
      return Promise.reject(new Error(`SQL not allowed statement: ${sql}`));
    }
    return executarDeVerdade(comando);
  };

  try {
    await migrar(banco);
    assert.deepStrictEqual(recusadas, [], 'nenhuma escrita de pragma pode ter sido tentada');
    assert.strictEqual((await uma(banco, 'SELECT versao FROM esquema')).versao, VERSAO_ATUAL);
    const tabelas = (await todas(banco, "SELECT name FROM sqlite_master WHERE type='table'")).map(
      (t) => t.name
    );
    assert.ok(tabelas.includes('usuarios') && tabelas.includes('tokens'), 'o banco ficou pronto');
  } finally {
    apagar();
  }
});

test('uma migração interrompida no meio pode ser rodada de novo', async () => {
  // Sem transação em volta dos degraus, uma queda de conexão pode deixar a
  // tabela temporária para trás. A tentativa seguinte não pode travar por isso.
  const { banco, apagar } = bancoTemporario();
  try {
    await montarFormatoOriginal(banco);
    await banco.executeMultiple('CREATE TABLE usuarios_novo (id TEXT);'); // sobra de uma tentativa
    await migrar(banco);

    assert.strictEqual((await uma(banco, 'SELECT COUNT(*) AS n FROM usuarios')).n, 3);
    assert.strictEqual((await uma(banco, 'SELECT versao FROM esquema')).versao, VERSAO_ATUAL);
  } finally {
    apagar();
  }
});

// ============================================================ a nova regra

test('depois da migração, o mesmo e-mail não pode aparecer em duas contas', async () => {
  const { banco, apagar } = bancoTemporario();
  try {
    await migrar(banco);
    const inserir = (id, apelido, chave) =>
      banco.execute({
        sql: `INSERT INTO usuarios (id, apelido, apelido_chave, email_chave, criado_em, visto_em)
              VALUES (?, ?, ?, ?, 1, 1)`,
        args: [id, apelido, chave, 'igual@gmail.com'],
      });

    await inserir('e1', 'Um', 'um');
    const erro = await inserir('e2', 'Dois', 'dois').then(
      () => null,
      (e) => e
    );
    assert.match(String(erro && erro.message), /UNIQUE/i);
  } finally {
    apagar();
  }
});

test('apagar uma conta leva junto os tokens dela, e nada mais', async () => {
  const { banco, apagar } = bancoTemporario();
  try {
    await migrar(banco);
    // A cascata so acontece com as chaves estrangeiras ligadas - e o servidor
    // liga isso ao abrir o banco (ver abrir() em banco.js).
    await banco.execute('PRAGMA foreign_keys = ON');
    await banco.execute(
      `INSERT INTO usuarios (id, apelido, apelido_chave, criado_em, visto_em)
       VALUES ('u','Um','um',1,1)`
    );
    await banco.execute(
      `INSERT INTO tokens (hash, usuario_id, tipo, expira_em, criado_em)
       VALUES ('abc','u','recuperar',9999999999999,1)`
    );

    await banco.execute("DELETE FROM usuarios WHERE id = 'u'");
    assert.strictEqual((await uma(banco, 'SELECT COUNT(*) AS n FROM tokens')).n, 0);
  } finally {
    apagar();
  }
});
