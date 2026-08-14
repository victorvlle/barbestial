// Motor de animacao das cartas.
//
// Tecnica usada: FLIP (First, Last, Invert, Play).
//   First  - mede onde cada carta esta AGORA
//   Last   - reorganiza o HTML para o estado novo (sem animacao nenhuma)
//   Invert - aplica um transform que "desfaz" a mudanca, deixando tudo
//            visualmente no lugar antigo
//   Play   - remove o transform com transicao; o navegador anima a diferenca
//
// A vantagem: nao precisamos programar cada movimento (empurrao do elefante,
// inversao da pinguim, ordenacao da águia). Qualquer mudanca de posicao vira
// animacao automaticamente, inclusive as que ainda nem imaginamos.

// Os dois numeros que controlam o ritmo do jogo. Aumente para deixar mais
// contemplativo, diminua para acelerar. Sao o unico lugar a mexer.
const DURACAO = 640; // ms que uma carta leva para deslizar ate o novo lugar
const PAUSA_ENTRE_QUADROS = 900; // respiro entre um passo do turno e o proximo
// Quando o passo ja teve holograma, o respiro e curto: o jogador acabou de ver
// o que aconteceu e o proximo nao pode perder tempo do relogio dele esperando.
const PAUSA_CURTA = 260;

const cartasVivas = new Map(); // uid -> elemento HTML reaproveitado entre quadros

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function elementoDaCarta(carta, cores, criar) {
  let el = cartasVivas.get(carta.uid);
  if (!el) {
    el = criar(carta, cores);
    el.dataset.uid = carta.uid;
    cartasVivas.set(carta.uid, el);
  }
  return el;
}

function esquecerCartas(uidsValidos) {
  for (const uid of [...cartasVivas.keys()]) {
    if (!uidsValidos.has(uid)) cartasVivas.delete(uid);
  }
}

// First: onde cada carta esta antes da mudanca
function medirTudo() {
  const posicoes = new Map();
  for (const [uid, el] of cartasVivas) {
    if (el.isConnected) posicoes.set(uid, el.getBoundingClientRect());
  }
  return posicoes;
}

// Invert + Play: anima a diferenca entre a posicao antiga e a nova
function animarDiferenca(antes) {
  for (const [uid, el] of cartasVivas) {
    if (!el.isConnected) continue;
    const depois = el.getBoundingClientRect();
    const anterior = antes.get(uid);

    if (!anterior) {
      // Carta que acabou de aparecer: entra de baixo, crescendo.
      el.animate(
        [
          { opacity: 0, transform: 'translateY(26px) scale(0.9)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: DURACAO, easing: 'cubic-bezier(.2,.7,.3,1)' }
      );
      continue;
    }

    const dx = anterior.left - depois.left;
    const dy = anterior.top - depois.top;
    const escalaX = anterior.width / depois.width;
    const escalaY = anterior.height / depois.height;
    const parada = Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(escalaX - 1) < 0.01;
    if (parada) continue;

    el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${escalaX}, ${escalaY})` },
        { transform: 'none' },
      ],
      { duration: DURACAO, easing: 'cubic-bezier(.2,.7,.3,1)' }
    );
  }
}

// Coloca as cartas nos containers na ordem pedida, reaproveitando os elementos.
// appendChild move o elemento existente em vez de criar outro - e isso que
// permite a carta "voar" da fila ate o bar em vez de sumir e reaparecer.
function posicionar(container, uids, mapaDeCartas, cores, criar, mini) {
  for (const uid of uids) {
    const carta = mapaDeCartas.get(uid);
    if (!carta) continue;
    const el = elementoDaCarta(carta, cores, criar);
    el.classList.toggle('carta--mini', Boolean(mini));
    // A cor do dono e reaplicada SEMPRE, nao so quando o elemento e criado:
    // um jogador pode ter outra cor numa partida seguinte, e o elemento
    // reaproveitado ficaria com a cor velha.
    el.style.setProperty('--cor-dono', `var(--${cores[carta.dono] || 'suave'})`);
    container.appendChild(el);
  }
}
