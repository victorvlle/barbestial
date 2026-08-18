// Lista as contas cadastradas e o ranking, direto do banco.
//
// Rode NO SERVIDOR onde o jogo está publicado:
//   node scripts/contas.js
//
// No Render: Dashboard -> seu serviço -> aba "Shell" -> cole o comando acima.
// Ele lê a mesma variável BANCO_CAMINHO que o servidor usa, então aponta
// sozinho para o banco de verdade.
//
// Opções:
//   node scripts/contas.js --semana 2026-S32   ranking de outra semana
//   node scripts/contas.js --json              saída em JSON, para copiar
//
// SENHAS: este script nunca imprime hash nem sal. Não existe como recuperar a
// senha de ninguém - ela não está guardada em lugar nenhum (ver usuarios.js).

const { abrir } = require('../server/dados/banco');
const ranking = require('../server/dados/ranking');

const argumentos = process.argv.slice(2);
const pegar = (nome) => {
  const i = argumentos.indexOf(nome);
  return i === -1 ? null : argumentos[i + 1];
};
const emJson = argumentos.includes('--json');
const semana = pegar('--semana') || ranking.chaveDaSemana();

const banco = abrir();
const quando = (t) => (t ? new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—');

// Uma linha por conta, com o quanto cada uma jogou.
const contas = banco
  .prepare(
    `SELECT u.id, u.apelido AS nome, u.google_email, u.criado_em, u.visto_em,
            (SELECT COUNT(*) FROM resultados r WHERE r.usuario_id = u.id) AS partidas
       FROM usuarios u
      ORDER BY u.criado_em DESC`
  )
  .all();

const tabela = ranking.rankingDaSemana(semana);
const totalDePartidas = banco.prepare('SELECT COUNT(*) AS n FROM partidas').get().n;

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
      `  ${c.nome.padEnd(18)} ${String(c.google_email || '—').padEnd(28)} ` +
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
console.log(`  Semanas com partidas: ${ranking.semanasComPartidas().map((s) => s.semana).join(', ') || '—'}\n`);
