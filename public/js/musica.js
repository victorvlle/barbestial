// Musica de fundo, tocada por um player do YouTube.
//
// POR QUE O PLAYER FICA VISIVEL, e nao escondido atras do jogo:
// os termos da API do YouTube exigem que o player tenha no minimo 200x200 px e
// que mais da metade dele esteja aparecendo para a reproducao automatica poder
// comecar. Tocar so o audio, esconder o player fora da tela ou cobri-lo com
// outra coisa nao e permitido. Entao ele vira um painel pequeno na mesa - que
// de quebra deixa trocar de faixa e ver o que esta tocando.
//
// Para trocar a playlist, mude a linha abaixo: e o codigo que aparece na URL do
// YouTube depois de "list=".
const PLAYLIST = 'PLGvo0--QIK2kKnUO3L1FPBYqEPSksEBIz';

const VOLUME = 100; // musica de fundo: baixa o suficiente para conversar por cima

let player = null;
let pronto = false;
let naTelaDoJogo = false;

// --------------------------------------------------------------- carregar

function carregarMusica() {
  if (document.getElementById('script-youtube')) return;
  const script = document.createElement('script');
  script.id = 'script-youtube';
  script.src = 'https://www.youtube.com/iframe_api';
  script.onerror = () => marcarIndisponivel('sem conexão com o YouTube');
  document.head.appendChild(script);
}

// A API do YouTube chama esta função global sozinha quando termina de carregar.
window.onYouTubeIframeAPIReady = () => {
  try {
    player = new YT.Player('player-musica', {
      width: '200',
      height: '200',
      playerVars: {
        listType: 'playlist',
        list: PLAYLIST,
        autoplay: 0,
        loop: 1,
        modestbranding: 1,
        rel: 0,
      },
      events: {
        onReady: () => {
          pronto = true;
          player.setVolume(VOLUME);
          aplicarMudo();
          if (naTelaDoJogo) tocar();
        },
        onError: () => marcarIndisponivel('não deu para carregar a playlist'),
      },
    });
  } catch (erro) {
    marcarIndisponivel('o player não pôde ser criado');
  }
};

function marcarIndisponivel(motivo) {
  const bloco = document.getElementById('bloco-musica');
  if (bloco) bloco.dataset.erro = motivo;
}

// ------------------------------------------------------------- controles

const podeTocar = () => pronto && player && typeof player.playVideo === 'function';

function tocar() {
  naTelaDoJogo = true;
  if (!podeTocar()) return;
  aplicarMudo();
  player.playVideo();
}

function parar() {
  naTelaDoJogo = false;
  if (podeTocar()) player.pauseVideo();
}

// Uma faixa diferente a cada partida: embaralha e cai num ponto aleatorio da
// playlist, em vez de comecar sempre pela primeira musica.
function sortearMusica() {
  naTelaDoJogo = true;
  if (!podeTocar()) return;
  const lista = player.getPlaylist() || [];
  const indice = lista.length ? Math.floor(Math.random() * lista.length) : 0;
  player.setShuffle(true);
  player.setLoop(true);
  player.playVideoAt(indice);
  player.setVolume(VOLUME);
  aplicarMudo();
}

function aplicarMudo() {
  if (!podeTocar()) return;
  if (preferencias.musicaLigada()) player.unMute();
  else player.mute();
}

function alternarMudo() {
  const ligada = !preferencias.musicaLigada();
  preferencias.definirMusica(ligada);
  aplicarMudo();
  // podeTocar() checa o player inteiro, nao so o metodo: quem tem o YouTube
  // bloqueado (rede da empresa, bloqueador de anuncios) fica com player nulo,
  // e o botao de mudo precisa continuar funcionando mesmo assim.
  if (ligada && naTelaDoJogo && podeTocar()) player.playVideo();
  return ligada;
}
