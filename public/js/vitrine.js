// A coluna da esquerda do menu: a vitrine dos animais e as suas marcas.
//
// POR QUE A VITRINE EXISTE: a barreira de entrada do Bar Bestial não é a regra
// do jogo - é decorar o que cada um dos 12 bichos faz. Ninguém abre "Instruções"
// antes de jogar. Aqui a arte de cada carta passa sozinha na frente da pessoa
// enquanto ela decide criar a sala, e o poder vem escrito junto. É ensino por
// exposição, sem pedir nada em troca.
//
// A arte é a mesma que a mesa usa (public/assets/cartas/<id>.webp), então isto
// não duplica imagem nenhuma. O texto vem do catálogo que o servidor manda -
// cards.js continua sendo a única fonte de verdade sobre as cartas.

const TROCA_MS = 5200; // tempo de cada carta na vitrine

let vitrineAtual = 0;
let vitrineRelogio = null;
let vitrineAnimais = [];

function pintarVitrine() {
  const animal = vitrineAnimais[vitrineAtual];
  if (!animal) return;

  const arte = $('vitrine-arte');
  // A troca de imagem apaga e acende: sem isso a carta nova aparece de estalo,
  // e o olho não acompanha o que mudou.
  arte.classList.add('trocando');
  setTimeout(() => {
    arte.src = `/assets/cartas/${animal.id}.webp`;
    arte.alt = animal.nome;
    arte.classList.remove('trocando');
  }, 180);

  $('vitrine-nome').textContent = animal.nome;
  $('vitrine-forca').textContent = animal.forca;
  $('vitrine-poder').textContent = animal.poder;

  for (const ponto of document.querySelectorAll('.vitrine-ponto')) {
    ponto.classList.toggle('vitrine-ponto--ativo', Number(ponto.dataset.indice) === vitrineAtual);
  }
}

function irParaAnimal(indice) {
  vitrineAtual = (indice + vitrineAnimais.length) % vitrineAnimais.length;
  pintarVitrine();
  reiniciarRelogioDaVitrine();
}

function reiniciarRelogioDaVitrine() {
  clearInterval(vitrineRelogio);
  vitrineRelogio = setInterval(() => irParaAnimal(vitrineAtual + 1), TROCA_MS);
}

async function iniciarVitrine() {
  const resposta = await fetch('/api/animais').then((r) => r.json()).catch(() => null);
  if (!resposta || !resposta.animais || !resposta.animais.length) return;

  vitrineAnimais = resposta.animais;

  // Um pontinho por carta, para dar noção de quantas existem (são 12) e deixar
  // pular direto para uma delas.
  const trilha = $('vitrine-pontos');
  trilha.innerHTML = '';
  vitrineAnimais.forEach((animal, indice) => {
    const ponto = document.createElement('button');
    ponto.className = 'vitrine-ponto';
    ponto.dataset.indice = indice;
    ponto.title = animal.nome;
    ponto.setAttribute('aria-label', animal.nome);
    ponto.addEventListener('click', () => irParaAnimal(indice));
    trilha.appendChild(ponto);
  });

  // Começa numa carta sorteada: quem abre o jogo duas vezes não vê a mesma.
  vitrineAtual = Math.floor(Math.random() * vitrineAnimais.length);
  pintarVitrine();
  reiniciarRelogioDaVitrine();

  // Passar o mouse segura a carta: ninguém consegue ler um texto que foge.
  const palco = $('vitrine');
  palco.addEventListener('mouseenter', () => clearInterval(vitrineRelogio));
  palco.addEventListener('mouseleave', reiniciarRelogioDaVitrine);
  palco.classList.remove('escondida');
}

// ------------------------------------------------------------- suas marcas

// Os números da própria pessoa. O ranking fala de quem está na frente; isto
// fala de você - e é o que dá motivo para voltar quando o jogo está vazio.
async function carregarEstatisticas() {
  const bloco = $('estatisticas');
  if (!CONTA) return bloco.classList.add('escondida');

  const r = await pedir('/api/conta/estatisticas');
  if (!r.ok) return bloco.classList.add('escondida');

  const { total, semana, melhorPosicao, posicaoNaSemana } = r.estatisticas;
  $('estat-partidas').textContent = total.partidas;
  $('estat-vitorias').textContent = total.vitorias;
  $('estat-semana').textContent = semana.pontos;
  $('estat-posicao').textContent = posicaoNaSemana ? `${posicaoNaSemana}º` : '—';

  // A frase embaixo muda conforme a situação: quem nunca jogou precisa de um
  // convite, não de um placar zerado.
  const recado = $('estat-recado');
  if (total.partidas === 0) {
    recado.textContent = 'Sua primeira partida entra no ranking na hora.';
  } else if (posicaoNaSemana === 1) {
    recado.textContent = 'Você está em primeiro esta semana. Segura aí até domingo.';
  } else if (melhorPosicao === 1) {
    recado.textContent = 'Você já foi primeiro numa mesa. Dá para repetir.';
  } else {
    recado.textContent = `Melhor posição até hoje: ${melhorPosicao}º lugar.`;
  }

  bloco.classList.remove('escondida');
}

// Uma partida terminou em algum lugar do jogo: se foi a sua, os números mudaram.
socket.on('ranking-atualizado', () => carregarEstatisticas());
