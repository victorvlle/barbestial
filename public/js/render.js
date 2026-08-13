// Desenha o estado na tela. Nao guarda regras: so mostra o que o servidor mandou
// e avisa main.js quando o jogador clica em alguma coisa.
//
// Ponto importante: os elementos das cartas sao REAPROVEITADOS entre um desenho
// e outro (ver animacao.js). Por isso nunca usamos innerHTML nas areas de carta -
// isso destruiria os elementos e mataria a animacao. Movemos os mesmos elementos
// de um lugar para o outro.

// Os desenhos ficam num unico arquivo SVG (public/assets/animais.svg), cada
// animal como um <symbol>. Aqui so apontamos para eles. A cor vem do CSS
// (currentColor), entao a mesma silhueta serve para as 4 cores de jogador.
const desenhoDo = (animal) =>
  `<svg class="silhueta" viewBox="0 0 100 100" aria-hidden="true"><use href="/assets/animais.svg#a-${animal}"/></svg>`;

// Setinha circular: marca as cartas cujo poder acontece de novo a cada turno.
const MARCA_RECORRENTE = `<span class="marca-rec" title="Poder recorrente: acontece de novo a cada turno">
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M20.5 12a8.5 8.5 0 1 1-2.5-6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    <path d="M20.5 2.5v6h-6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg></span>`;

const $ = (id) => document.getElementById(id);

function mostrarTela(qual) {
  for (const tela of document.querySelectorAll('.tela')) {
    tela.classList.toggle('escondida', tela.id !== `tela-${qual}`);
  }
}

function avisar(elementoId, mensagem) {
  $(elementoId).textContent = mensagem || '';
}

function criarCarta(carta, cores) {
  const animal = CATALOGO[carta.animal] || { nome: carta.animal, forca: '?' };
  const div = document.createElement('div');
  div.className = 'carta';
  div.style.setProperty('--cor-dono', `var(--${cores[carta.dono] || 'suave'})`);
  div.innerHTML = `
    <span class="cabecalho">
      <span class="forca">${animal.forca}</span>
      ${animal.recorrente ? MARCA_RECORRENTE : '<span></span>'}
      <button class="info" type="button" aria-label="O que ${animal.nome} faz">i</button>
    </span>
    <span class="bicho">${desenhoDo(carta.animal)}</span>
    <span class="nome">${animal.nome}</span>`;

  // O clique no "i" nao pode virar uma jogada: paramos a propagacao aqui.
  // O listener e criado junto com a carta, uma unica vez - por isso nao empilha.
  div.querySelector('.info').addEventListener('click', (evento) => {
    evento.stopPropagation();
    mostrarBalao(evento.currentTarget, carta.animal);
  });
  return div;
}

// Tira do container qualquer carta que nao deveria mais estar ali.
function limparSobras(container, uids) {
  for (const filho of [...container.children]) {
    if (!uids.includes(filho.dataset.uid)) filho.remove();
  }
}

// Desenha UM quadro do tabuleiro e anima a diferenca em relacao ao anterior.
// quadro = { fila: [uid], bar: [uid], ralo: [uid], mao: [uid] }
function pintarTabuleiro(quadro, mapaDeCartas, cores) {
  const antes = medirTudo();

  posicionar($('fila'), quadro.fila, mapaDeCartas, cores, criarCarta, false);
  posicionar($('bar'), quadro.bar, mapaDeCartas, cores, criarCarta, true);
  posicionar($('ralo'), quadro.ralo, mapaDeCartas, cores, criarCarta, true);
  posicionar($('mao'), quadro.mao, mapaDeCartas, cores, criarCarta, false);

  limparSobras($('fila'), quadro.fila);
  limparSobras($('bar'), quadro.bar);
  limparSobras($('ralo'), quadro.ralo);
  limparSobras($('mao'), quadro.mao);

  $('contagem-bar').textContent = quadro.bar.length;
  $('contagem-ralo').textContent = quadro.ralo.length;

  animarDiferenca(antes);
}

// Junta todas as cartas que o cliente conhece: uid -> dados da carta.
function mapearCartas(estado) {
  const eu = estado.jogadores.find((j) => j.id === estado.souEu);
  const todas = [...estado.fila, ...estado.bar, ...estado.ralo, ...(eu?.mao || [])];
  return new Map(todas.map((c) => [c.uid, c]));
}

const uids = (cartas) => cartas.map((c) => c.uid);

function quadroFinal(estado) {
  const eu = estado.jogadores.find((j) => j.id === estado.souEu);
  return {
    fila: uids(estado.fila),
    bar: uids(estado.bar),
    ralo: uids(estado.ralo),
    mao: uids(eu?.mao || []),
  };
}

// Quadros intermediarios nao trazem a mao: usamos sempre a mao final.
function quadroDaJogada(quadro, estado) {
  const eu = estado.jogadores.find((j) => j.id === estado.souEu);
  const naMao = new Set(uids(eu?.mao || []));
  // Uma carta nao pode estar na mao e na fila ao mesmo tempo durante a animacao.
  const emJogo = new Set([...quadro.fila, ...quadro.bar, ...quadro.ralo]);
  return {
    fila: quadro.fila,
    bar: quadro.bar,
    ralo: quadro.ralo,
    mao: [...naMao].filter((uid) => !emJogo.has(uid)),
  };
}

// ------------------------------------------------------------------- paineis

function renderizarSala(sala, meuId) {
  $('codigo-sala').textContent = sala.codigo;

  const lista = $('lista-jogadores');
  lista.innerHTML = '';
  for (const jogador of sala.jogadores) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="bolinha" style="background: var(--${jogador.cor})"></span>
      <span>${jogador.nome}</span>
      <span class="tag">${jogador.id === sala.anfitriao ? 'anfitrião' : ''}${
        jogador.id === meuId ? ' • você' : ''
      }</span>`;
    lista.appendChild(li);
  }

  const souAnfitriao = sala.anfitriao === meuId;
  const gente = sala.jogadores.length;
  const botao = $('btn-comecar');
  botao.disabled = !souAnfitriao || gente < sala.minimo;
  botao.textContent = souAnfitriao
    ? `Começar partida (${gente}/${sala.maximo})`
    : 'Esperando o anfitrião começar…';
  avisar('aviso-sala', souAnfitriao && gente < sala.minimo ? 'Precisa de mais um jogador.' : '');
}

// acoes = { podeJogar, cartaEmEscolha, escolhendoAlvo, aoClicarMao, aoClicarFila }
function renderizarJogo(estado, acoes = {}) {
  const cores = Object.fromEntries(estado.jogadores.map((j) => [j.id, j.cor]));
  const mapa = mapearCartas(estado);
  const daVez = estado.jogadores.find((j) => j.id === estado.vezDe);
  const minhaVez = estado.vezDe === estado.souEu && estado.fase === 'jogando';

  pintarTabuleiro(quadroFinal(estado), mapa, cores);
  esquecerCartas(new Set(mapa.keys()));

  if (estado.fase === 'terminado') {
    const nomes = (estado.vencedores || []).map((v) => v.nome).join(' e ');
    $('vez').innerHTML = `Fim de jogo! Vitória de <strong>${nomes}</strong>`;
  } else {
    $('vez').innerHTML = minhaVez
      ? 'É a <strong>sua vez</strong> — clique numa carta da sua mão'
      : `Vez de <strong>${daVez ? daVez.nome : '—'}</strong>`;
  }
  document.querySelector('.mesa').classList.toggle('minha-vez', minhaVez);

  // Cliques: usamos onclick (propriedade) de proposito. Como os elementos sao
  // reaproveitados, addEventListener empilharia um handler novo a cada desenho.
  for (const filho of $('fila').children) {
    const alvo = Boolean(acoes.escolhendoAlvo);
    filho.classList.toggle('alvo', alvo);
    filho.onclick = alvo ? () => acoes.aoClicarFila(mapa.get(filho.dataset.uid)) : null;
    filho.onmouseenter = alvo ? () => acoes.aoPassarNaFila?.(mapa.get(filho.dataset.uid)) : null;
    filho.onmouseleave = alvo ? () => acoes.aoSairDaCarta?.() : null;
  }
  for (const filho of $('mao').children) {
    const jogavel = Boolean(acoes.podeJogar);
    filho.classList.toggle('jogavel', jogavel);
    filho.classList.toggle('selecionada', acoes.cartaEmEscolha?.uid === filho.dataset.uid);
    filho.onclick = jogavel ? () => acoes.aoClicarMao(mapa.get(filho.dataset.uid)) : null;
    filho.onmouseenter = jogavel ? () => acoes.aoPassarNaMao?.(mapa.get(filho.dataset.uid)) : null;
    filho.onmouseleave = jogavel ? () => acoes.aoSairDaCarta?.() : null;
  }
  if (!acoes.escolhendoAlvo && !acoes.podeJogar) esconderPrevia();

  $('dica-mao').textContent =
    estado.fase === 'terminado'
      ? 'Partida encerrada.'
      : minhaVez
        ? 'Passe o mouse sobre a carta para ler o poder dela.'
        : 'Aguarde sua vez.';

  const placar = $('placar');
  placar.innerHTML = '';
  for (const linha of estado.placar) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="bolinha" style="background: var(--${linha.cor})"></span>
      <span>${linha.nome}</span>
      <span class="pontos">${linha.entraram}</span>`;
    placar.appendChild(li);
  }

  const log = $('log');
  log.innerHTML = '';
  for (const linha of [...estado.log].reverse()) {
    const li = document.createElement('li');
    li.textContent = linha.texto;
    // A linha ganha a cor de QUEM agiu. Numa ação recorrente isso é o dono do
    // animal, que pode não ser o jogador da vez.
    if (linha.dono && cores[linha.dono]) {
      li.style.borderLeftColor = `var(--${cores[linha.dono]})`;
      li.classList.add('com-dono');
    }
    log.appendChild(li);
  }
}

// Barra de escolha: aparece so quando a carta jogada pede uma decisao.
function renderizarEscolha(escolha, estado, acoes) {
  const barra = $('escolha');
  if (!escolha) {
    barra.classList.add('escondida');
    return;
  }
  barra.classList.remove('escondida');

  const opcoes = $('escolha-opcoes');
  opcoes.innerHTML = '';

  if (escolha.tipo === 'animal') {
    $('escolha-texto').textContent = 'Clique no animal da fila que você quer enxotar:';
  }

  if (escolha.tipo === 'pular1ou2') {
    $('escolha-texto').textContent = 'Pular quantos animais?';
    for (const quantos of [1, 2]) {
      if (quantos > estado.fila.length) continue;
      const botao = document.createElement('button');
      botao.textContent = quantos === 1 ? 'Pular 1' : 'Pular 2';
      botao.addEventListener('click', () => acoes.concluir({ pulos: quantos }));
      botao.addEventListener('mouseenter', () => acoes.espiar?.(`pulos:${quantos}`));
      botao.addEventListener('mouseleave', () => esconderPrevia());
      opcoes.appendChild(botao);
    }
  }

  if (escolha.tipo === 'especie') {
    $('escolha-texto').textContent = 'Qual animal da fila o camaleão vai imitar?';
    const especies = [...new Set(estado.fila.map((c) => c.animal))].filter((e) => e !== 'camaleao');
    for (const especie of especies) {
      const animal = CATALOGO[especie];
      const botao = document.createElement('button');
      botao.innerHTML = `${desenhoDo(especie)} ${animal.nome} (${animal.forca})`;
      botao.title = animal.poder;
      botao.addEventListener('click', () => acoes.escolherEspecie(especie));
      botao.addEventListener('mouseenter', () => acoes.espiar?.(`especie:${especie}`));
      botao.addEventListener('mouseleave', () => esconderPrevia());
      opcoes.appendChild(botao);
    }
  }
}


// ---------------------------------------------------------------- prévia

// Desenha, em cartas menores e translúcidas, como a fila ficaria se o jogador
// jogasse a carta sobre a qual está o mouse. Os dados vêm prontos do servidor.
function mostrarPrevia(previsao, estado, mapaDeCartas, cores) {
  const caixa = $('previa');
  const linha = $('previa-linha');
  if (!previsao) return esconderPrevia();

  const antesBar = new Set(estado.bar.map((c) => c.uid));
  const antesRalo = new Set(estado.ralo.map((c) => c.uid));
  const entram = previsao.bar.filter((uid) => !antesBar.has(uid));
  const saem = previsao.ralo.filter((uid) => !antesRalo.has(uid));

  linha.innerHTML = '';

  const grupo = (uids, marca, titulo) => {
    if (uids.length === 0) return;
    const bloco = document.createElement('div');
    bloco.className = `previa-grupo previa-grupo--${marca}`;
    bloco.title = titulo;
    for (const uid of uids) {
      const carta = mapaDeCartas.get(uid);
      if (!carta) continue;
      const el = criarCarta(carta, cores);
      el.classList.add('carta--mini', 'carta--fantasma');
      el.querySelector('.info')?.remove();
      bloco.appendChild(el);
    }
    const etiqueta = document.createElement('span');
    etiqueta.className = 'previa-etiqueta';
    etiqueta.textContent = titulo;
    bloco.appendChild(etiqueta);
    linha.appendChild(bloco);
  };

  grupo(entram, 'entra', 'entra no bar');
  grupo(previsao.fila, 'fila', 'fica na fila');
  grupo(saem, 'sai', 'vai pro ralo');

  caixa.classList.add('previa--ativa');
}

function esconderPrevia() {
  $('previa').classList.remove('previa--ativa');
}

// ------------------------------------------------------------ balão do "i"

function mostrarBalao(botao, animalId) {
  const animal = CATALOGO[animalId];
  if (!animal) return;
  const balao = $('balao');
  balao.innerHTML = `
    <strong>${animal.nome} <span class="balao-forca">força ${animal.forca}</span></strong>
    <p>${animal.poder}</p>
    ${animal.nota ? `<p class="balao-nota">${animal.nota}</p>` : ''}
    ${animal.recorrente ? '<p class="balao-marca">Poder recorrente: acontece de novo a cada turno.</p>' : ''}`;
  balao.classList.remove('escondida');

  // Posiciona perto do botão, sem sair da tela.
  const r = botao.getBoundingClientRect();
  const largura = balao.offsetWidth;
  const esquerda = Math.min(Math.max(8, r.left + r.width / 2 - largura / 2), window.innerWidth - largura - 8);
  const acima = r.top > balao.offsetHeight + 16;
  balao.style.left = `${esquerda}px`;
  balao.style.top = `${acima ? r.top - balao.offsetHeight - 10 : r.bottom + 10}px`;
}

function esconderBalao() {
  $('balao').classList.add('escondida');
}

// ------------------------------------------------------------- instruções

function textoDasInstrucoes() {
  const linhas = Object.values(CATALOGO)
    .sort((a, b) => b.forca - a.forca)
    .map(
      (a) => `<li>
        <span class="instr-icone">${desenhoDo(a.id)}</span>
        <span class="instr-forca">${a.forca}</span>
        <span><strong>${a.nome}</strong> ${a.recorrente ? `<em class="instr-rec">${MARCA_RECORRENTE} recorrente</em>` : ''}
        <br />${a.poder}</span>
      </li>`
    )
    .join('');

  return `
    <h2 class="instr-titulo">Como se joga</h2>
    <p>Cada jogador tem os mesmos 12 animais, numa cor. Ganha quem colocar
    <strong>mais animais próprios dentro do bar</strong>. Em caso de empate, ganha quem
    somar menos força entre os animais que entraram.</p>

    <h3>O turno, passo a passo</h3>
    <ol class="instr-passos">
      <li>Você joga uma carta no <strong>fim da fila</strong> (o lado oposto à porta).</li>
      <li>O poder dessa carta acontece.</li>
      <li>Disparam os poderes <strong>recorrentes</strong> dos animais que já estavam na fila,
          da porta em direção ao fim.</li>
      <li>Se a fila chegar a <strong>5 animais</strong>: os 2 da frente entram no bar
          e o último vai pro ralo.</li>
      <li>Você compra uma carta nova.</li>
    </ol>
    <p class="instr-dica">A ordem importa: é ela que faz a foca inverter a fila e cair
    na boca de um crocodilo no mesmo turno.</p>

    <h3>Os 12 animais</h3>
    <ul class="instr-lista">${linhas}</ul>`;
}
