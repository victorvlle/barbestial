// AS FESTAS: as playlists do jogo.
//
// A REGRA E SIMPLES: o que esta na pasta e o que toca.
//
// O jogo NAO tem uma lista fixa de musicas que precisa bater com nome de
// arquivo. Ele abre a pasta da festa, ve o que tem la dentro e monta a playlist.
// Adicionar musica = jogar o arquivo na pasta. Tirar = apagar o arquivo.
//
// (A primeira versao exigia nomes exatos - 01-levels.mp3 e por ai. Na pratica
// isso obriga a renomear tudo na mao e, pior, se o nome nao bate o jogo diz que
// a musica "falta" enquanto ela esta ali na frente. Ler a pasta acaba com os
// dois problemas.)
//
// O NOME DO ARQUIVO VIRA O QUE APARECE NO TOCADOR:
//   "Levels - Avicii.mp3"          ->  Avicii — Levels
//   "Heaven Takes You Home - Swedish House Mafia.mp3"
//                                  ->  Swedish House Mafia — Heaven Takes You Home
//   "musica sem tracinho.mp3"      ->  musica sem tracinho
// Ou seja: "Titulo - Artista", separado pelo PRIMEIRO tracinho. E o formato que
// a maioria dos arquivos ja usa.
//
// COMO ADICIONAR UMA FESTA NOVA:
//   1. acrescente um bloco em FESTAS aqui embaixo (id, nome, emoji);
//   2. ponha os arquivos em audio-original/<id>/ e rode scripts/abafar.js.
// O seletor no menu e o tocador se ajustam sozinhos.
//
// SOBRE OS ARQUIVOS: sao gravacoes de terceiros e nao nascem com o projeto -
// ver public/assets/festas/LEIA.md.

const fs = require('fs');
const path = require('path');

// FESTAS_PASTA existe para os testes: eles apontam para uma pasta descartavel e
// exercitam o sistema inteiro sem encostar nos arquivos de verdade.
const PASTA = process.env.FESTAS_PASTA || path.join(__dirname, '..', '..', 'public', 'assets', 'festas');

// Formatos que o navegador toca sem drama.
const FORMATOS = ['.mp3', '.m4a', '.ogg', '.opus', '.wav'];

const FESTAS = [
  {
    id: 'edm',
    nome: 'EDM',
    emoji: '⚡',
    descricao: 'Os hinos de festival que todo mundo canta junto.',
  },
  {
    id: 'summer-eletro-2000s',
    nome: 'Summer Eletro 2000s',
    emoji: '☀️',
    descricao: 'A pista de beira de piscina dos anos 2000.',
  },
];

// "Titulo - Artista.mp3" -> { titulo, artista }
function lerNome(arquivo) {
  const semExtensao = arquivo.replace(/\.[^.]+$/, '').trim();
  const corte = semExtensao.indexOf(' - ');
  if (corte === -1) return { titulo: semExtensao, artista: '' };
  return {
    titulo: semExtensao.slice(0, corte).trim(),
    artista: semExtensao.slice(corte + 3).trim(),
  };
}

// O endereco publico. encodeURIComponent porque nome de musica tem espaco,
// parentese e acento - e sem isso o navegador pede o arquivo errado.
const enderecoDaFaixa = (festaId, arquivo) =>
  `/assets/festas/${festaId}/${encodeURIComponent(arquivo)}`;

function faixasDe(festaId) {
  const pasta = path.join(PASTA, festaId);
  if (!fs.existsSync(pasta)) return [];

  return fs
    .readdirSync(pasta)
    .filter((nome) => FORMATOS.includes(path.extname(nome).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .map((arquivo) => ({
      ...lerNome(arquivo),
      arquivo,
      url: enderecoDaFaixa(festaId, arquivo),
    }));
}

// O catalogo com a realidade do disco. Le a pasta a cada chamada de proposito:
// basta soltar um arquivo la para a musica entrar na festa, sem reiniciar nada.
function catalogo() {
  return FESTAS.map((festa) => {
    const faixas = faixasDe(festa.id);
    return { ...festa, faixas, total: faixas.length };
  });
}

// Um resumo para o log da subida e para `npm run musicas`.
const resumo = () => catalogo().map((f) => `${f.emoji} ${f.nome}: ${f.total} faixa(s)`);

module.exports = { FESTAS, catalogo, faixasDe, lerNome, resumo, PASTA, FORMATOS };
