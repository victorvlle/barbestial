// Desenha o estado na tela. Nao guarda regras: so mostra o que o servidor mandou
// e avisa main.js quando o jogador clica em alguma coisa.
//
// Ponto importante: os elementos das cartas sao REAPROVEITADOS entre um desenho
// e outro (ver animacao.js). Por isso nunca usamos innerHTML nas areas de carta -
// isso destruiria os elementos e mataria a animacao. Movemos os mesmos elementos
// de um lugar para o outro.

// Cada carta tem sua arte em public/assets/cartas/<id>.webp. A arte ja traz o
// numero e o nome do animal impressos, entao o codigo NAO desenha nenhum dos
// dois por cima - seria informacao repetida.
const imagemDo = (animal) =>
  `<img class="arte" src="/assets/cartas/${animal}.webp" alt="" draggable="false" />`;

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
  // A música só existe dentro da partida. Sair da mesa pausa; voltar retoma.
  if (typeof tocar === 'function') (qual === 'jogo' ? tocar : parar)();
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
    ${imagemDo(carta.animal)}
    <span class="marcas">
      ${animal.recorrente ? MARCA_RECORRENTE : ''}
      <button class="info" type="button" aria-label="O que ${animal.nome} faz">i</button>
    </span>
    <span class="forca-mini">${animal.forca}</span>`;

  // O clique no "i" nao pode virar uma jogada: paramos a propagacao aqui.
  // O listener e criado junto com a carta, uma unica vez - por isso nao empilha.
  const botaoInfo = div.querySelector('.info');
  botaoInfo.addEventListener('click', (evento) => {
    evento.stopPropagation();
    mostrarBalao(evento.currentTarget, carta.animal);
  });
  // Chegar perto do "i" ja tira a previa da frente: ela e informativa e nao
  // pode competir com um botao.
  botaoInfo.addEventListener('mouseenter', () => esconderPrevia());
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

// acoes = { podeJogar, cartaEmEscolha, emEscolha, opcaoDaCarta, aoClicarMao, ... }
function renderizarJogo(estado, acoes = {}) {
  const cores = Object.fromEntries(estado.jogadores.map((j) => [j.id, j.cor]));
  const mapa = mapearCartas(estado);
  const daVez = estado.jogadores.find((j) => j.id === estado.vezDe);
  const minhaVez = estado.vezDe === estado.souEu && estado.fase === 'jogando';

  pintarTabuleiro(quadroFinal(estado), mapa, cores);
  esquecerCartas(new Set(mapa.keys()));

  // Quantas cartas ainda faltam comprar, e quem está só assistindo
  const eu = estado.jogadores.find((j) => j.id === estado.souEu);
  const meuBaralho = eu?.cartasNoBaralho ?? 0;
  $('baralho').textContent = estado.espectador
    ? ''
    : meuBaralho === 0
      ? '· baralho vazio'
      : `· ${meuBaralho} ${meuBaralho === 1 ? 'carta' : 'cartas'} para comprar`;

  const quantos = estado.espectadores?.length || 0;
  const assistindo = $('assistindo');
  assistindo.classList.toggle('escondida', quantos === 0);
  assistindo.textContent = quantos === 1 ? '1 assistindo' : `${quantos} assistindo`;
  assistindo.title = (estado.espectadores || []).map((e) => e.nome).join(', ');

  const faixa = $('faixa');
  if (estado.espectador) {
    const daVezAgora = estado.jogadores.find((j) => j.id === estado.vezDe);
    $('vez').innerHTML =
      estado.fase === 'terminado'
        ? `Fim de jogo — vitória de <strong>${(estado.vencedores || []).map((v) => v.nome).join(' e ')}</strong>`
        : `<span class="selo-assiste">ASSISTINDO</span> vez de <strong style="color: var(--${cores[estado.vezDe]})">${daVezAgora ? daVezAgora.nome : '—'}</strong>`;
    faixa.classList.remove('faixa--minha-vez');
    document.title = 'Bar Bestial';
  } else if (estado.fase === 'terminado') {
    const nomes = (estado.vencedores || []).map((v) => v.nome).join(' e ');
    $('vez').innerHTML = `Fim de jogo — vitória de <strong>${nomes}</strong>`;
    faixa.classList.remove('faixa--minha-vez');
  } else if (!acoes.emEscolha) {
    $('vez').innerHTML = minhaVez
      ? '<span class="selo-vez">SUA VEZ</span> escolha uma carta da sua mão'
      : `Vez de <strong style="color: var(--${cores[estado.vezDe]})">${daVez ? daVez.nome : '—'}</strong>`;
    faixa.classList.toggle('faixa--minha-vez', minhaVez);
  }
  document.querySelector('.mesa').classList.toggle('minha-vez', minhaVez);

  // Aviso fora da aba: quem está com o jogo em segundo plano vê pelo título.
  document.title = minhaVez ? '▶ Sua vez — Bar Bestial' : 'Bar Bestial';

  // Cliques: usamos onclick (propriedade) de proposito. Como os elementos sao
  // reaproveitados, addEventListener empilharia um handler novo a cada desenho.
  // Toda decisão do jogo acontece clicando numa carta da fila: quem o tucano
  // enxota, quem o polvo vira, até onde o coelho pula. O rótulo em cima da
  // carta diz o que aquele clique faz.
  const filhos = [...$('fila').children];
  filhos.forEach((filho, i) => {
    const carta = mapa.get(filho.dataset.uid);
    const opcao = acoes.opcaoDaCarta?.(carta, i, filhos.length);
    filho.classList.toggle('alvo', Boolean(opcao));
    filho.dataset.rotulo = opcao?.rotulo || '';
    filho.onclick = opcao ? () => acoes.aoEscolherNaFila(opcao) : null;
    filho.onmouseenter = opcao ? () => acoes.aoPassarNaFila?.(opcao) : null;
    filho.onmouseleave = opcao ? () => acoes.aoSairDaCarta?.() : null;
  });
  for (const filho of $('mao').children) {
    const jogavel = Boolean(acoes.podeJogar);
    filho.classList.toggle('jogavel', jogavel);
    filho.classList.toggle('selecionada', acoes.cartaEmEscolha?.uid === filho.dataset.uid);
    filho.onclick = jogavel ? () => acoes.aoClicarMao(mapa.get(filho.dataset.uid)) : null;
    filho.onmouseenter = jogavel ? () => acoes.aoPassarNaMao?.(mapa.get(filho.dataset.uid)) : null;
    filho.onmouseleave = jogavel ? () => acoes.aoSairDaCarta?.() : null;
  }
  if (!acoes.emEscolha && !acoes.podeJogar) esconderPrevia();

  // Espectador nao tem mao: o bloco some e o rodape se reorganiza (o CSS cuida
  // das colunas a partir desta classe).
  document.getElementById('tela-jogo').classList.toggle('assiste', Boolean(estado.espectador));
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
    li.className = linha.id === estado.vezDe ? 'joga-agora' : '';
    li.style.setProperty('--c', `var(--${linha.cor})`);
    li.innerHTML = `
      <span class="bolinha" style="background: var(--${linha.cor})"></span>
      <span class="placar-nome">${linha.nome}</span>
      <span class="pontos">${linha.entraram}</span>`;
    placar.appendChild(li);
  }

  const log = $('log');
  log.innerHTML = '';
  for (const linha of [...estado.log].reverse()) {
    const li = document.createElement('li');

    // Cada linha vem do servidor em pedaços. Os que representam uma carta trazem
    // o dono, e viram uma etiqueta com a cor dele - assim dá para ver de quem
    // era o animal que foi devorado, não só quem devorou.
    for (const pedaco of linha.partes || []) {
      if (pedaco.dono && cores[pedaco.dono]) {
        const etiqueta = document.createElement('span');
        etiqueta.className = 'bicho-nome';
        etiqueta.style.setProperty('--c', `var(--${cores[pedaco.dono]})`);
        etiqueta.textContent = pedaco.t;
        li.appendChild(etiqueta);
      } else {
        li.appendChild(document.createTextNode(pedaco.t));
      }
    }

    if (linha.dono && cores[linha.dono]) {
      li.style.borderLeftColor = `var(--${cores[linha.dono]})`;
      li.classList.add('com-dono');
    }
    log.appendChild(li);
  }
}

// A faixa no topo diz de quem e a vez ou, durante uma decisao, o que fazer.
function renderizarEscolha(escolha) {
  const faixa = $('faixa');
  const botao = $('btn-cancelar');
  faixa.classList.toggle('faixa--decidindo', Boolean(escolha));
  botao.classList.toggle('escondida', !escolha);
  if (!escolha) return;

  const instrucoes = {
    animal: 'Clique no animal da fila que você quer enxotar',
    especie: 'Clique no animal da fila que o polvo vai virar',
    pular1ou2: 'Clique em até onde o coelho vai pular',
  };
  $('vez').innerHTML = `<span class="decidir">decida</span> ${instrucoes[escolha.tipo] || ''}`;
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
      el.querySelector('.marcas')?.remove();
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
        <span class="instr-icone">${imagemDo(a.id)}</span>
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
    <p class="instr-dica">A ordem importa: é ela que faz o pinguim inverter a fila e cair
    na boca de um tubarão no mesmo turno.</p>

    <h3>Os 12 animais</h3>
    <ul class="instr-lista">${linhas}</ul>`;
}


// ------------------------------------------------------- fim de partida

function explicarResultado(resultado) {
  const nomes = resultado.vencedores.map((v) => v.nome).join(' e ');
  const n = resultado.vencedores[0].entraram;

  if (resultado.criterio === 'empate-total') {
    return {
      titulo: 'Empate!',
      quem: nomes,
      motivo: `Mesma quantidade de animais no bar (${n}) e a mesma soma de forças.
               Não dá para desempatar: a vitória é dividida.`,
    };
  }

  if (resultado.criterio === 'forca') {
    const perdedores = resultado.empatados.filter(
      (p) => !resultado.vencedores.some((v) => v.id === p.id)
    );
    const somaVencedor = resultado.vencedores[0].somaForcas;
    const somaOutros = perdedores.map((p) => `${p.nome} ${p.somaForcas}`).join(', ');
    return {
      titulo: 'Vitória no desempate!',
      quem: nomes,
      motivo: `Empate em <strong>${n} animais</strong> no bar. O desempate é a
               <strong>menor soma de forças</strong> entre os animais que entraram —
               e aí ${nomes} levou, com <strong>${somaVencedor}</strong> contra ${somaOutros}.
               Enfiar bichos fracos no bar vale mais do que parece.`,
    };
  }

  return {
    titulo: 'Fim de jogo!',
    quem: nomes,
    motivo: `${n === 1 ? '1 animal' : `${n} animais`} dentro do bar — mais que todo mundo.`,
  };
}

function mostrarFimDeJogo(estado) {
  const resultado = estado.resultado;
  if (!resultado) return;
  const cores = Object.fromEntries(estado.jogadores.map((j) => [j.id, j.cor]));
  const { titulo, quem, motivo } = explicarResultado(resultado);
  const corVencedor = cores[resultado.vencedores[0].id];

  const linhas = resultado.tabela
    .map((p) => {
      const ganhou = resultado.vencedores.some((v) => v.id === p.id);
      return `<li class="${ganhou ? 'ganhou' : ''}">
        <span class="bolinha" style="background: var(--${p.cor})"></span>
        <span>${p.nome}</span>
        <span class="fim-num">${p.entraram}</span>
        <span class="fim-forca">soma ${p.somaForcas}</span>
      </li>`;
    })
    .join('');

  $('fim-conteudo').innerHTML = `
    <div class="fim-tacao">🏆</div>
    <h2 class="fim-titulo">${titulo}</h2>
    <p class="fim-quem" style="color: var(--${corVencedor})">${quem}</p>
    <p class="fim-motivo">${motivo}</p>
    <ul class="fim-placar">
      <li class="fim-cabecalho"><span></span><span>jogador</span><span>bar</span><span>desempate</span></li>
      ${linhas}
    </ul>`;

  soltarConfete(corVencedor);
  $('fim').classList.remove('escondida');
}

function soltarConfete(cor) {
  const caixa = $('confete');
  caixa.innerHTML = '';
  const cores = [`var(--${cor})`, 'var(--neon)', '#ffe9c2'];
  for (let i = 0; i < 40; i++) {
    const papel = document.createElement('i');
    papel.style.left = `${Math.random() * 100}%`;
    papel.style.background = cores[i % cores.length];
    papel.style.animationDelay = `${Math.random() * 1.2}s`;
    papel.style.animationDuration = `${2.4 + Math.random() * 1.8}s`;
    papel.style.transform = `rotate(${Math.random() * 360}deg)`;
    caixa.appendChild(papel);
  }
}


// A votação da revanche, visível para todos: cada um vê a decisão de cada um.
function renderizarVotos(sala, meuId) {
  const caixa = $('fim-votos');
  if (!sala) return caixa.classList.add('escondida');

  const estados = {
    sim: { texto: 'quer jogar de novo', classe: 'voto--sim' },
    nao: { texto: 'saiu', classe: 'voto--nao' },
    null: { texto: 'decidindo…', classe: 'voto--esperando' },
  };

  caixa.innerHTML = `<p class="fim-esperando">Esperando os outros decidirem…</p>` +
    sala.jogadores
      .map((j) => {
        const e = estados[j.revanche] || estados.null;
        return `<div class="voto ${e.classe}">
          <span class="bolinha" style="background: var(--${j.cor})"></span>
          <span>${j.nome}${j.id === meuId ? ' (você)' : ''}</span>
          <span class="voto-estado">${e.texto}</span>
        </div>`;
      })
      .join('');
  caixa.classList.remove('escondida');
}
