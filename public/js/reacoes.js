// AS REAÇÕES DA MESA.
//
// Um jogador clica num emoji e ele sobe na tela de todo mundo da sala, com o
// nome de quem mandou. É só isso. NÃO é um chat: não existe campo de texto em
// lugar nenhum, não dá para escrever nada, e a lista de emojis é fechada e mora
// no servidor (server/game/reacoes.js) - o que não está nela o servidor recusa.
//
// ONDE ELAS APARECEM: numa zona própria no rodapé, ao lado das "Últimas
// jogadas". Esse espaço já existia no layout (era onde o player de música
// morava antes de virar um canto flutuante), então as reações não roubam área
// de nada: não passam por cima de carta, nem da mão, nem da fila, nem do bar,
// nem do ralo. Foi de propósito - emoji voando em cima das cartas atrapalha
// justamente na hora em que o jogador precisa ler a mesa.
//
// O CAMINHO DE UMA REAÇÃO:
//   clique -> aparece na hora aqui (sem esperar a rede) -> socket 'reagir'
//   -> servidor confere e reenvia para a sala -> aparece na tela dos outros
// Quem mandou ignora o próprio eco, senão a reação apareceria duas vezes.
//
// NADA DISSO É GUARDADO. Reação não vai para o banco, não vira histórico, não
// entra no registro da partida. Ela vive os três segundos da animação e some.

// Quantas reações podem estar voando ao mesmo tempo. Passou disso, a mais
// antiga sai na frente: é o que impede que muita gente clicando junto (ou um
// engraçadinho no console) transforme a tela num muro de emoji.
const MAX_NA_TELA = 12;

// Quanto tempo cada uma fica. Precisa bater com a duração da animação no CSS.
const VIDA_MS = 3200;

// Trava de ritmo no próprio navegador, combinando com a do servidor. Sem ela, a
// pessoa manda 10 seguidas, o servidor recusa da sexta em diante e ela vê na
// própria tela reações que mais ninguém viu.
const INTERVALO_MIN_MS = 550;

// `EMOJIS`, e nao `REACOES`: holograma.js ja usa esse nome para as classes de
// animacao das cartas, e dois `const`/`let` com o mesmo nome no escopo global do
// navegador derrubam a pagina inteira com erro de sintaxe.
let EMOJIS = [];
let ultimoEnvio = 0;
let naTela = [];

// ===================================================== emoji que a fonte não tem
//
// O PROBLEMA: emoji não é imagem, é letra - quem desenha é a fonte do sistema.
// Windows, Android e Mac atualizam essa fonte em ritmos diferentes, então um
// emoji novo demais simplesmente não existe na máquina de quem está jogando, e
// o navegador desenha o "tofu": aquele quadradinho vazio.
//
// O caso concreto deste projeto é o 🫪 (U+1FAEA, "rosto com olheiras"), que é do
// Unicode 16 (2024) e ainda não está na fonte do Windows. O 🫠 (U+1FAE0, "rosto
// derretendo", Unicode 14) falta em Windows 10.
//
// A SOLUÇÃO: perguntar ao navegador, em tempo de carregamento, se ele sabe
// desenhar cada emoji da lista. Quem ele não souber, desenhamos nós, em SVG - o
// MESMO emoji, não outro no lugar. Numa máquina que já tem a fonte nova, o
// desenho nativo continua sendo usado; o SVG só entra onde faltaria.
const DESENHOS = {
  // 🫪 U+1FAEA - rosto com olheiras
  '1faea': `<svg viewBox="0 0 36 36" role="img" aria-label="rosto com olheiras">
    <circle cx="18" cy="18" r="16" fill="#FFCC4D"/>
    <path d="M8.4 11.4c1.8-1.2 4-1.4 5.8-.6" stroke="#664500" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    <path d="M27.6 11.4c-1.8-1.2-4-1.4-5.8-.6" stroke="#664500" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    <ellipse cx="12.2" cy="16" rx="2.1" ry="2.7" fill="#664500"/>
    <ellipse cx="23.8" cy="16" rx="2.1" ry="2.7" fill="#664500"/>
    <path d="M8.7 19.6c1.7 2.6 5.3 2.6 7 0" stroke="#D89B2A" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    <path d="M20.3 19.6c1.7 2.6 5.3 2.6 7 0" stroke="#D89B2A" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    <path d="M9.9 22.1c1.3 1.9 4.3 1.9 5.6 0" stroke="#D89B2A" stroke-width="1.2" fill="none" stroke-linecap="round" opacity=".7"/>
    <path d="M20.5 22.1c1.3 1.9 4.3 1.9 5.6 0" stroke="#D89B2A" stroke-width="1.2" fill="none" stroke-linecap="round" opacity=".7"/>
    <path d="M13.6 27.2h8.8" stroke="#664500" stroke-width="1.9" stroke-linecap="round"/>
  </svg>`,

  // 🫠 U+1FAE0 - rosto derretendo
  '1fae0': `<svg viewBox="0 0 36 36" role="img" aria-label="rosto derretendo">
    <path d="M32.6 15.9c0 5.9-3.6 11.1-8.9 13.3-1.4.6-2 1.4-2.3 2.7-.4 1.9-2 3.1-4 3-2.1-.1-3.8-1.9-3.8-4 0-1.2-.6-1.8-1.7-2.2C6.8 26.4 3.4 21.5 3.4 15.9 3.4 8.2 10 2 18 2s14.6 6.2 14.6 13.9z" fill="#FFCC4D"/>
    <path d="M20.9 31.4c1.9.1 3.2 1.3 3.1 2.7-.1 1.3-1.7 2.2-3.4 1.8" fill="#F0B03A"/>
    <ellipse cx="11.9" cy="14.8" rx="2.1" ry="2.7" fill="#664500"/>
    <path d="M23.6 12.2c1.2 0 2.2 1.1 2.2 2.5v6.6c0 1.4-1 2.5-2.2 2.5s-2.2-1.1-2.2-2.5v-6.6c0-1.4 1-2.5 2.2-2.5z" fill="#664500"/>
    <path d="M10.7 20.9c2.1 3 5.9 4.1 9.2 2.6" stroke="#664500" stroke-width="1.8" fill="none" stroke-linecap="round"/>
  </svg>`,
};

// COMO SE DESCOBRE QUE A FONTE NÃO TEM O EMOJI
//
// A primeira tentativa foi comparar os pixels do emoji com os de um caractere
// que não existe (U+10FFFF) e ver se saíam iguais. NÃO FUNCIONA: quando falta o
// glifo, o navegador não desenha um quadrado vazio - ele desenha uma caixinha
// COM O NÚMERO DO CARACTERE EM HEXADECIMAL DENTRO. Como cada caractere tem um
// número diferente, as caixinhas nunca saem idênticas, e a comparação dizia
// "tem, sim" para um emoji que na tela era um quadradinho. Foi exatamente esse
// o quadrado que apareceu na máquina do Victor.
//
// O QUE FUNCIONA é a LARGURA. Fonte de emoji desenha todos os emojis com a
// mesma largura de avanço - 😀, 🔥 e ⏳ ocupam exatamente o mesmo espaço. Quando
// o glifo falta, quem desenha é outra fonte (a de "último recurso"), e a
// largura sai diferente. Medido neste projeto: emoji de verdade 29.9px, a
// caixinha do 🫪 24px, o caractere inexistente 18px.
//
// Então: medimos o 😀 (que está em toda fonte de emoji desde 2015) e comparamos.
// Bateu a largura, o sistema sabe desenhar. Não bateu, entra o nosso desenho.
const REFERENCIA = '\u{1F600}'; // 😀
const NAO_EXISTE = '\u{10FFFF}'; // o fim do espaço Unicode: nunca vai ser nada

function fonteDesenha(emoji) {
  const tamanho = 24;
  const tela = document.createElement('canvas');
  tela.width = tela.height = tamanho * 2;
  const pincel = tela.getContext('2d', { willReadFrequently: true });
  if (!pincel) return true; // sem canvas, não dá para conferir: confia na fonte
  pincel.font = `${tamanho}px sans-serif`;

  const largura = (texto) => pincel.measureText(texto).width;
  const daFonte = largura(REFERENCIA);
  const doNada = largura(NAO_EXISTE);

  // Se o 😀 mede o mesmo que um caractere inexistente, esta máquina não tem
  // fonte de emoji nenhuma - não há o que comparar.
  if (!daFonte || Math.abs(daFonte - doNada) < 1) return false;

  const dele = largura(emoji);
  // 8% de folga: é mais do que qualquer arredondamento e menos do que a
  // diferença entre a fonte de emoji e a de último recurso.
  if (Math.abs(dele - daFonte) > daFonte * 0.08) return false;

  // Segunda conferida, barata: um glifo que sai IDÊNTICO ao caractere
  // inexistente é quadradinho, mesmo que a largura tenha batido por acaso.
  const pixels = (texto) => {
    pincel.clearRect(0, 0, tela.width, tela.height);
    pincel.font = `${tamanho}px sans-serif`;
    pincel.textBaseline = 'top';
    pincel.fillStyle = '#000';
    pincel.fillText(texto, 0, 0);
    return pincel.getImageData(0, 0, tela.width, tela.height).data;
  };
  const nada = pixels(NAO_EXISTE);
  const desenho = pixels(emoji);
  let temTinta = false;
  for (let i = 3; i < desenho.length; i += 4) {
    if (desenho[i] !== 0) { temTinta = true; break; }
  }
  if (!temTinta) return false;
  for (let i = 0; i < desenho.length; i++) {
    if (desenho[i] !== nada[i]) return true;
  }
  return false;
}

// Memória do resultado: a conta acima é barata, mas é boba refazê-la a cada
// emoji desenhado na tela.
const sabidos = new Map();
const temNaFonte = (emoji) => {
  if (!sabidos.has(emoji)) sabidos.set(emoji, fonteDesenha(emoji));
  return sabidos.get(emoji);
};

const codigoDe = (emoji) =>
  [...emoji]
    .filter((c) => c !== '\uFE0F')
    .map((c) => c.codePointAt(0).toString(16))
    .join('-');

// Monta o emoji pronto para ir na tela: o caractere quando a fonte dá conta, o
// nosso desenho quando não dá.
function pintarEmoji(emoji) {
  const caixa = document.createElement('span');
  caixa.className = 'emoji';
  if (temNaFonte(emoji)) {
    caixa.textContent = emoji;
    return caixa;
  }
  const desenho = DESENHOS[codigoDe(emoji)];
  if (desenho) {
    caixa.classList.add('emoji--desenhado');
    caixa.innerHTML = desenho;
    return caixa;
  }
  // Chegar aqui significa emoji sem fonte E sem desenho nosso. Não trocamos por
  // outro emoji escondido: avisamos no console para virar desenho na próxima vez.
  console.warn(`[reações] o emoji ${emoji} (U+${codigoDe(emoji)}) não existe na fonte deste sistema e ainda não tem desenho em DESENHOS.`);
  caixa.textContent = emoji;
  return caixa;
}

// ===================================================================== bandeja

async function iniciarReacoes() {
  const resposta = await fetch('/api/reacoes').then((r) => r.json()).catch(() => null);
  EMOJIS = (resposta && resposta.reacoes) || [];
  desenharBandeja();
}

function desenharBandeja() {
  const bandeja = $('reacoes-bandeja');
  if (!bandeja) return;
  bandeja.innerHTML = '';
  for (const emoji of EMOJIS) {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'reacao-opcao';
    botao.dataset.emoji = emoji;
    botao.setAttribute('role', 'menuitem');
    botao.setAttribute('aria-label', `Reagir com ${emoji}`);
    botao.appendChild(pintarEmoji(emoji));
    botao.addEventListener('click', () => mandarReacao(emoji, botao));
    bandeja.appendChild(botao);
  }
}

function abrirBandeja(abrir) {
  const bandeja = $('reacoes-bandeja');
  if (!bandeja) return;
  bandeja.classList.toggle('escondida', !abrir);
  const botao = $('btn-reacoes');
  if (botao) botao.classList.toggle('aberto', abrir);
}

// ==================================================================== enviar

function mandarReacao(emoji, botao) {
  const agora = Date.now();
  if (agora - ultimoEnvio < INTERVALO_MIN_MS) return;
  ultimoEnvio = agora;

  // O feedback é imediato de propósito: a reação já sobe na tela de quem clicou
  // antes de a rede responder. Se ela fosse esperar o eco do servidor, um
  // segundo de internet ruim viraria "o botão não funcionou".
  if (botao) {
    botao.classList.remove('reacao-opcao--enviada');
    void botao.offsetWidth; // reinicia a animação mesmo em cliques seguidos
    botao.classList.add('reacao-opcao--enviada');
  }
  const eu = (estadoAtual?.jogadores || ultimaSala?.jogadores || []).find((j) => j.id === JOGADOR_ID);
  mostrarReacao({
    emoji,
    nome: eu?.nome || (CONTA && CONTA.nome) || 'você',
    cor: eu?.cor,
    jogadorId: JOGADOR_ID,
  });
  abrirBandeja(false);

  enviar('reagir', { emoji });
}

// ==================================================================== mostrar

function mostrarReacao({ emoji, nome, cor, jogadorId }) {
  const palco = $('reacoes-palco');
  if (!palco) return;

  const bolha = document.createElement('div');
  // Três jeitos de subir, escolhidos pelo emoji: assim 😂 e 🔥 não fazem
  // exatamente o mesmo movimento, e a tela não fica com cara de engrenagem.
  const jeito = [...emoji][0].codePointAt(0) % 3;
  bolha.className = `reacao reacao--v${jeito}`;
  if (jogadorId === JOGADOR_ID) bolha.classList.add('reacao--minha');
  // Nasce em pontos diferentes da faixa para duas reações juntas não colarem
  // uma na outra.
  bolha.style.setProperty('--saida', `${26 + Math.random() * 48}%`);
  bolha.style.setProperty('--deriva', `${(Math.random() * 2 - 1) * 14}px`);
  if (cor) bolha.style.setProperty('--c', `var(--${cor})`);

  bolha.appendChild(pintarEmoji(emoji));
  const quem = document.createElement('span');
  quem.className = 'reacao-nome';
  quem.textContent = nome || '';
  bolha.appendChild(quem);

  palco.appendChild(bolha);
  naTela.push(bolha);

  // Muita gente clicando junto não pode virar um muro: a mais antiga sai.
  while (naTela.length > MAX_NA_TELA) naTela.shift().remove();

  setTimeout(() => {
    bolha.remove();
    naTela = naTela.filter((b) => b !== bolha);
  }, VIDA_MS);
}

function limparReacoes() {
  for (const bolha of naTela) bolha.remove();
  naTela = [];
  abrirBandeja(false);
}

// O eco do servidor. Quem mandou já viu a própria reação subir no clique - por
// isso ignoramos o próprio id aqui, senão ela apareceria duas vezes.
socket.on('reacao', (dados) => {
  if (!dados || dados.jogadorId === JOGADOR_ID) return;
  mostrarReacao(dados);
});
