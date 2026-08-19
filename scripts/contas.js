// Lista as contas cadastradas e o ranking, direto do banco.
//
// Rode NO SERVIDOR onde o jogo está publicado:
//   node scripts/contas.js
//
// No Render: Dashboard -> seu serviço -> aba "Shell" -> cole o comando acima.
// Ele lê as mesmas variáveis de banco que o servidor usa (TURSO_URL, ou
// BANCO_CAMINHO no ambiente local), então aponta sozinho para o banco certo.
//
// Opções:
//   node scripts/contas.js --semana 2026-S32   ranking de outra semana
//   node scripts/contas.js --json              saída em JSON, para copiar
//
// SENHAS: este script nunca imprime hash nem sal. Não existe como recuperar a
// senha de ninguém - ela não está guardada em lugar nenhum (ver usuarios.js).

const banco = require('../server/dados/banco');
const ranking = require('../server/dados/ranking');

const argumentos = process.argv.slice(2);
const pegar = (nome) => {
  const i = argumentos.indexOf(nome);
  return i === -1 ? null : argumentos[i + 1];
};
const emJson = argumentos.includes('--json');
const semana = pegar('--semana') || ranking.chaveDaSemana();

const quando = (t) => (t ? new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—');

async function principal() {
  // Uma linha por conta, com o quanto cada uma jogou.
  const contas = await banco.tudo(
    `SELECT u.id, u.apelido AS nome, u.email, u.email_verificado_em, u.criado_em, u.visto_em,
            (SELECT COUNT(*) FROM resultados r WHERE r.usuario_id = u.id) AS partidas
       FROM usuarios u
      ORDER BY u.criado_em DESC`
  );

  const tabela = await ranking.rankingDaSemana(semana);
  const totalDePartidas = (await banco.um('SELECT COUNT(*) AS n FROM partidas')).n;

  if (emJson) {
    console.log(JSON.stringify({ semana, contas, ranking: tabela, totalDePartidas }, null, 2));
    process.exit(0);
  }

  console.log(`\n=== CONTAS (${contas.length}) ===\n`);
  if (contas.length === 0) {
    console.log('  Ninguém se cadastrou ainda.');
  } else {
    for (const c of contas) {
      console.log(
        `  ${c.nome.padEnd(18)} ${String((c.email || '—') + (c.email_verificado_em ? ' ✓' : ' ✗')).padEnd(30)} ` +
          `criada em ${quando(c.criado_em).padEnd(20)} ` +
          `último acesso ${quando(c.visto_em).padEnd(20)} ` +
          `${c.partidas} partida(s)`
      );
      console.log(`  ${''.padEnd(18)} id: ${c.id}`);
    }
  }

  console.log(`\n=== RANKING ${semana} ===\n`);
  if (tabela.length === 0) {
    console.log('  Nenhuma partida nesta semana.');
  } else {
    for (const l of tabela) {
      console.log(
        `  ${String(l.posicao).padStart(2)}. ${l.nome.padEnd(18)} ` +
          `${String(l.pontos).padStart(3)} pts   ` +
          `${l.partidas} partida(s), ${l.vitorias} vitória(s)`
      );
    }
  }

  console.log(`\n  Partidas registradas no total: ${totalDePartidas}`);
  const semanas = await ranking.semanasComPartidas();
  console.log(`  Semanas com partidas: ${semanas.map((s) => s.semana).join(', ') || '—'}\n`);
}

banco
  .abrir()
  .then(principal)
  .catch((erro) => {
    console.error('\n  Não consegui ler o banco:', erro.message, '\n');
    process.exit(1);
  });
