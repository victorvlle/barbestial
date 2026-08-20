// A MÚSICA DO JOGO.
//
// O player de vídeo de terceiros que existia aqui virou um <audio> comum,
// tocando arquivos que fazem parte do projeto. O que se ganhou com a troca:
// nada de rede de fora, nada de anúncio, nada de "indisponível no seu país",
// nada de player de 200x200 obrigatório no meio da mesa. E, o principal, dá
// para tratar o áudio antes (ver scripts/abafar.js): as faixas já vêm com o
// efeito de "festa do outro lado da parede".
//
// AS FESTAS vêm de /api/festas, que é o servidor lendo a pasta de verdade.
// Festa sem arquivo nenhum não aparece para escolher - melhor não oferecer do
// que oferecer silêncio.
//
// QUANDO A MÚSICA TOCA: só dentro da partida. Escolher a festa no menu é só
// escolher - nada começa a tocar ali. Ao sair da mesa para o menu, a música
// para. É o comportamento que o jogo pede: o menu é silêncio, a mesa é festa.
//
// A ORDEM: sorteio por "saco de bolas". Embaralha as faixas, toca uma a uma até
// acabar o saco, e só então embaralha de novo - garantindo que todas tocam
// antes de qualquer repetição. Ao embaralhar de novo, se a primeira nova for
// igual à última tocada, ela é trocada de lugar: nunca a mesma música duas
// vezes seguidas.

// Volume cheio por padrão. As faixas já saem do tratamento no mesmo volume
// (ver scripts/abafar.js), e o efeito de parede por si só derruba muito a
// energia - começar em 70% deixava tudo baixo demais.
const VOLUME_PADRAO = 1;

let FESTAS = [];          // o catálogo que veio do servidor
let festaAtual = null;    // a festa escolhida
let saco = [];            // as faixas ainda não tocadas nesta rodada
let faixaAtual = null;
let naTelaDoJogo = false;

const audio = new Audio();
audio.preload = 'none';

// ------------------------------------------------------------------ ajudas

const festaPorId = (id) => FESTAS.find((f) => f.id === id) || null;

// Só faz sentido oferecer festa que tem música dentro.
const festasComMusica = () => FESTAS.filter((f) => f.total > 0);

function embaralhar(lista) {
  const copia = lista.slice();
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

// Enche o saco de novo, evitando emendar a mesma faixa duas vezes.
function encherOSaco() {
  if (!festaAtual) return;
  saco = embaralhar(festaAtual.faixas);
  if (saco.length > 1 && faixaAtual && saco[0].url === faixaAtual.url) {
    [saco[0], saco[1]] = [saco[1], saco[0]];
  }
}

// ------------------------------------------------------------- carregar

async function carregarMusica() {
  const r = await fetch('/api/festas').then((res) => res.json()).catch(() => null);
  FESTAS = (r && r.festas) || [];

  const possiveis = festasComMusica();
  const guardada = preferencias.festa();
  festaAtual = possiveis.find((f) => f.id === guardada) || possiveis[0] || null;

  audio.volume = preferencias.volume();
  audio.muted = !preferencias.musicaLigada();
  encherOSaco();

  desenharEscolhaDeFesta();
  pintarTocador();
}

// ------------------------------------------------------------ reprodução

// Toca a próxima do saco. Quando o saco esvazia, embaralha tudo de novo.
function proximaFaixa(comecarTocando = true) {
  if (!festaAtual) return;
  if (!saco.length) encherOSaco();
  if (!saco.length) return;

  faixaAtual = saco.shift();
  audio.src = faixaAtual.url;
  audio.load();
  if (comecarTocando) tentarTocar();
  pintarTocador();
}

// O navegador só deixa tocar áudio depois de um clique em algum lugar da
// página. Se ele recusar, não é erro: guardamos para tocar no próximo clique.
function tentarTocar() {
  const promessa = audio.play();
  if (promessa && promessa.catch) {
    promessa.catch(() => {
      esperandoUmClique = true;
      pintarTocador();
    });
  }
}

let esperandoUmClique = false;
document.addEventListener(
  'click',
  () => {
    if (!esperandoUmClique || !faixaAtual) return;
    esperandoUmClique = false;
    tentarTocar();
    pintarTocador();
  },
  { capture: true }
);

// Uma faixa acabou: emenda a próxima sem pausa nenhuma.
audio.addEventListener('ended', () => proximaFaixa(true));

// Arquivo faltando ou corrompido não pode travar a festa: pula para a próxima.
audio.addEventListener('error', () => {
  if (!faixaAtual) return;
  console.warn('[música] não consegui tocar', faixaAtual.url);
  proximaFaixa(true);
});

audio.addEventListener('timeupdate', pintarProgresso);
audio.addEventListener('play', pintarTocador);
audio.addEventListener('pause', pintarTocador);

// Escolher a festa no menu. NÃO toca nada: só guarda a escolha e prepara a
// ordem. Quem começa a festa é a partida.
function escolherFesta(id) {
  const escolhida = festaPorId(id);
  if (!escolhida) return false;

  festaAtual = escolhida;
  preferencias.definirFesta(escolhida.id);
  faixaAtual = null;
  encherOSaco();
  desenharEscolhaDeFesta();
  pintarTocador();
  return true;
}

// Entrou na mesa: a festa começa.
function tocar() {
  naTelaDoJogo = true;
  if (!festaAtual) return;
  if (!faixaAtual) proximaFaixa(true);
  else if (audio.paused && preferencias.musicaLigada()) tentarTocar();
}

// Saiu da mesa: a festa para. Sem isso a música continuaria no menu, e o menu
// não é festa.
function parar() {
  naTelaDoJogo = false;
  audio.pause();
  pintarTocador();
}

// Partida nova: ordem nova. É o que garante que duas partidas seguidas não
// tocam a mesma sequência.
function sortearMusica() {
  if (!festaAtual) return;
  encherOSaco();
  proximaFaixa(true);
}

function alternarPausa() {
  if (!faixaAtual) return proximaFaixa(true);
  if (audio.paused) tentarTocar();
  else audio.pause();
  pintarTocador();
}

function alternarMudo() {
  const ligada = !preferencias.musicaLigada();
  preferencias.definirMusica(ligada);
  audio.muted = !ligada;
  if (ligada && faixaAtual && audio.paused) tentarTocar();
  pintarTocador();
  return ligada;
}

function mudarVolume(valor) {
  const v = Math.min(1, Math.max(0, Number(valor)));
  audio.volume = v;
  preferencias.definirVolume(v);
}

// ------------------------------------------------------------ a tela

// O seletor de festa, no menu. Os botões são desenhados a partir do catálogo -
// festa nova aparece aqui sozinha, sem tocar neste arquivo.
function desenharEscolhaDeFesta() {
  const bloco = $('festas');
  if (!bloco) return;

  const possiveis = festasComMusica();
  // Sem nenhum arquivo de música no projeto, o bloco todo some. Nada de
  // oferecer uma festa que só tem silêncio.
  bloco.classList.toggle('escondida', possiveis.length === 0);
  if (!possiveis.length) return;

  const lista = $('festas-lista');
  lista.innerHTML = '';
  for (const festa of possiveis) {
    const botao = document.createElement('button');
    // `festa-opcao`, e não `festa`: esta última já é a classe do confete do
    // babuíno, e a animação dela deixaria os botões invisíveis.
    botao.className = 'festa-opcao' + (festaAtual && festa.id === festaAtual.id ? ' festa-opcao--ativa' : '');
    botao.dataset.festa = festa.id;
    botao.title = `${festa.descricao} (${festa.total} faixa${festa.total === 1 ? '' : 's'})`;

    const emoji = document.createElement('span');
    emoji.className = 'festa-emoji';
    emoji.textContent = festa.emoji;

    const nome = document.createElement('span');
    nome.className = 'festa-nome';
    nome.textContent = festa.nome;

    botao.append(emoji, nome);
    botao.addEventListener('click', () => escolherFesta(festa.id));
    lista.appendChild(botao);
  }
}

// O tocador: pequeno, no canto, com o essencial. Ele aparece só quando existe
// festa para tocar.
function pintarTocador() {
  const caixa = $('tocador');
  if (!caixa) return;

  // O tocador é da mesa, igual à música: no menu ele não aparece, porque no
  // menu não toca nada.
  const temMusica = Boolean(naTelaDoJogo && festaAtual && festaAtual.total && faixaAtual);
  caixa.classList.toggle('escondida', !temMusica);
  if (!temMusica) return;

  $('tocador-festa').textContent = `${festaAtual.emoji} ${festaAtual.nome}`;
  $('tocador-faixa').textContent = faixaAtual
    ? [faixaAtual.artista, faixaAtual.titulo].filter(Boolean).join(' — ')
    : 'toque para começar a festa';

  const tocando = Boolean(faixaAtual) && !audio.paused && !esperandoUmClique;
  $('tocador-play').textContent = tocando ? '❚❚' : '▶';
  $('tocador-play').title = tocando ? 'Pausar' : 'Tocar';
  caixa.classList.toggle('tocador--tocando', tocando);

  const btnMudo = $('btn-mudo');
  if (btnMudo) {
    btnMudo.classList.toggle('mudo', !preferencias.musicaLigada());
    btnMudo.title = preferencias.musicaLigada() ? 'Desligar a música' : 'Ligar a música';
  }
  const volume = $('tocador-volume');
  if (volume && document.activeElement !== volume) volume.value = String(audio.volume);

  pintarProgresso();
}

function pintarProgresso() {
  const barra = $('tocador-progresso');
  if (!barra) return;
  const parte = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
  barra.style.width = `${Math.min(100, Math.max(0, parte))}%`;
}
