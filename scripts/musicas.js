// O QUE O JOGO TEM DE MÚSICA.
//
//   npm run musicas
//
// Lista o que está em cada festa, do jeito que vai aparecer no tocador. É a
// resposta objetiva para "as músicas estão no projeto?".

const festas = require('../server/game/festas');

console.log('');
let total = 0;
for (const festa of festas.catalogo()) {
  console.log(`  ${festa.emoji}  ${festa.nome} — ${festa.total} faixa(s)`);
  for (const faixa of festa.faixas) {
    console.log(`      ${faixa.artista ? faixa.artista + ' — ' : ''}${faixa.titulo}`);
  }
  if (!festa.total) {
    console.log('      (vazia: esta festa não aparece no menu)');
    console.log(`      ponha os arquivos em audio-original/${festa.id}/ e rode: node scripts/abafar.js`);
  }
  console.log('');
  total += festa.total;
}

if (!total) {
  console.log('  Nenhuma música no projeto ainda. Veja public/assets/festas/LEIA.md\n');
}
