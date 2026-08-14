// Hologramas: a camada de teatro do jogo.
//
// O QUE ESTE ARQUIVO E:
//   Um leitor de efeitos. O servidor manda, junto com cada jogada, uma lista de
//   "efeitos" - anotacoes do que cada poder decidiu (ver server/game/queue.js).
//   Aqui a gente le essa lista e encena. Nada mais.
//
// O QUE ESTE ARQUIVO NAO E:
//   Ele nao decide nada. Nao calcula forca, nao escolhe alvo, nao mexe na fila.
//   Se este arquivo inteiro desaparecer, a partida continua identica - so sem
//   os bichos de luz. Toda animacao esta embrulhada em try/catch e tem prazo de
//   validade: se uma travar ou der erro, o turno segue.
//
// COMO O TEMPO FUNCIONA:
//   A jogada vem quebrada em QUADROS (fotos do tabuleiro). Cada efeito sabe em
//   qual quadro ele acontece. O maestro reproduzirEfeitos() e chamado ANTES de
//   pintar aquele quadro - entao a mordida do tubarao acontece enquanto a
//   vitima ainda esta na fila, e ela some logo depois. E essa ordem que faz a
//   animacao parecer causa e efeito, e nao dois acontecimentos soltos.

const HOLO = {
  PRAZO_POR_EFEITO: 2200, // nenhuma animacao segura o jogo por mais que isso
  ORCAMENTO_POR_QUADRO: 2800, // e um quadro inteiro nao passa disso
  COR_PADRAO: '#7fe3ff',
};

let palco = null;
const guardados = new Map(); // memoria curta entre dois efeitos (o polvo usa)

function iniciarPalco() {
  palco = document.getElementById('palco');
  return palco;
}

// Duas condicoes para animar: o jogador nao desligou, e o sistema dele nao pede
// menos movimento. A segunda respeita quem sente enjoo com animacao.
function hologramasLigados() {
  const semMovimento =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ligado = typeof preferencias === 'object' ? preferencias.holoLigado() : true;
  return ligado && !semMovimento;
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ onde as coisas estao
//
// Tudo aqui le a tela, nunca o estado do jogo: a posicao real da carta naquele
// instante. Se a carta ja saiu da tela, devolvemos null e quem chamou desiste
// daquele pedaco da animacao - sem quebrar o resto.

function ondeEsta(uid) {
  if (!uid) return null;
  const el = document.querySelector(`.carta[data-uid="${CSS.escape(uid)}"]`);
  if (!el || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  if (!r.width) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, el, rect: r };
}

// A area da fila serve de palco padrao: quando um efeito nao tem alvo nenhum
// (o babuíno sozinho, por exemplo), o holograma aparece no meio dela.
function areaDaFila() {
  const el = document.getElementById('fila');
  const r = el ? el.getBoundingClientRect() : null;
  if (!r || !r.width) {
    return { esquerda: innerWidth * 0.35, direita: innerWidth * 0.65, meio: innerWidth / 2, y: innerHeight / 2, altura: 130 };
  }
  return {
    esquerda: r.left + 26,
    direita: r.right - 26,
    meio: r.left + r.width / 2,
    y: r.top + r.height / 2,
    altura: r.height,
  };
}

// A cor do dono vira a cor da luz. Sem dono conhecido, o ciano padrao.
function corDe(cores, donoId) {
  const nome = cores && cores[donoId];
  if (!nome) return HOLO.COR_PADRAO;
  const lido = getComputedStyle(document.documentElement).getPropertyValue(`--${nome}`).trim();
  return lido || HOLO.COR_PADRAO;
}

// A cor de uma carta especifica, lida da propria carta na tela. Serve para as
// cenas com dois animais de donos diferentes (o impasse do cavalo, o duelo de
// lobos): cada holograma sai na cor de quem jogou aquele bicho.
function corDaCarta(uid) {
  const alvo = ondeEsta(uid);
  if (!alvo) return HOLO.COR_PADRAO;
  const lido = getComputedStyle(alvo.el).getPropertyValue('--cor-dono').trim();
  if (!lido) return HOLO.COR_PADRAO;
  if (!lido.startsWith('var(')) return lido;
  const nome = lido.slice(4, -1).trim();
  return getComputedStyle(document.documentElement).getPropertyValue(nome).trim() || HOLO.COR_PADRAO;
}

// A receita de tingimento do CSS (grayscale -> sepia -> hue-rotate) precisa
// saber QUANTOS graus girar. O sepia deixa tudo por volta de 35 graus de matiz;
// daqui sai a diferenca ate a matiz da cor do dono.
const MATIZ_DO_SEPIA = 35;

function matizDe(cor) {
  const m = /^#?([0-9a-f]{6})$/i.exec((cor || '').trim());
  if (!m) return 193; // ciano padrao
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const maior = Math.max(r, g, b);
  const menor = Math.min(r, g, b);
  const d = maior - menor;
  if (!d) return 0;
  let h;
  if (maior === r) h = ((g - b) / d) % 6;
  else if (maior === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

// ------------------------------------------------------------ pecas de cena

// O holograma de um animal. Devolve um controle simples em vez do elemento cru,
// para as coreografias la embaixo ficarem legiveis.
function criarHolo(animal, { cor, escala = 1, x = 0, y = 0, vira = 1 } = {}) {
  const el = document.createElement('div');
  el.className = 'holo';
  el.style.setProperty('--cor-holo', cor || HOLO.COR_PADRAO);
  el.style.setProperty('--holo-giro', `${matizDe(cor || HOLO.COR_PADRAO) - MATIZ_DO_SEPIA}deg`);
  el.style.setProperty('--escala', escala);
  el.style.setProperty('--vira', vira);
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.innerHTML = `
    <div class="holo-entrada">
      <div class="holo-corpo">
        <div class="holo-brilho"></div>
        <img class="holo-arte" src="/assets/holo/${animal}.webp" alt="" draggable="false" />
        <div class="holo-varredura"></div>
      </div>
      <div class="holo-base"></div>
    </div>`;
  palco.appendChild(el);

  return {
    el,
    mover(nx, ny, { escala: novaEscala, vira: novoVira } = {}) {
      el.style.left = `${nx}px`;
      el.style.top = `${ny}px`;
      if (novaEscala !== undefined) el.style.setProperty('--escala', novaEscala);
      if (novoVira !== undefined) el.style.setProperty('--vira', novoVira);
    },
    trocarArte(outroAnimal) {
      const img = el.querySelector('.holo-arte');
      if (img) img.src = `/assets/holo/${outroAnimal}.webp`;
    },
    async sumir(espera = 300) {
      el.classList.add('holo--saindo');
      await dormir(espera);
      el.remove();
    },
  };
}

// Um efeito curto e descartavel (rastro, onda, dente, faisca...). Ele se apaga
// sozinho: nao ha nada para limpar depois.
function solto(classe, x, y, { cor, vida = 900, texto, vars } = {}) {
  const el = document.createElement('div');
  el.className = `efeito ${classe}`;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.setProperty('--cor-holo', cor || HOLO.COR_PADRAO);
  if (vars) for (const [chave, valor] of Object.entries(vars)) el.style.setProperty(chave, valor);
  if (texto) el.textContent = texto;
  palco.appendChild(el);
  setTimeout(() => el.remove(), vida);
  return el;
}

// Faz a CARTA DE VERDADE reagir. A classe some sozinha depois de ms.
// Detalhe importante: as classes de reacao animam a arte DENTRO da carta, nunca
// a carta - o motor de FLIP mede a posicao das cartas e um transform ali
// atrapalharia o deslize seguinte. Ver o comentario no style.css.
function reagir(uid, classe, ms = 500) {
  const alvo = ondeEsta(uid);
  if (!alvo) return;
  alvo.el.classList.add(classe);
  setTimeout(() => alvo.el.classList.remove(classe), ms);
}

// ------------------------------------------------------------ coreografias
//
// Uma funcao por tipo de efeito. Todas recebem o mesmo contexto e podem esperar
// o tempo que quiserem - o maestro corta em PRAZO_POR_EFEITO de qualquer jeito.
//
// Cada uma so encena o que o efeito diz. Nenhuma consulta a fila para "decidir"
// nada: se o alvo nao esta mais na tela, aquele pedaco simplesmente nao acontece.

const ANIMACOES = {
  // O lobo alfa corre por fora da fila ate a porta do bar.
  async lobo(ctx) {
    const fila = ctx.fila();
    const partida = ctx.onde(ctx.efeito.autor) || { x: fila.direita, y: fila.y };
    const holo = ctx.holo({ x: partida.x, y: fila.y - 20, escala: 1.15, vira: -1 });

    await ctx.esperar(240);
    // Rastros ao longo do caminho, da direita para a esquerda.
    for (let i = 0; i < 4; i++) {
      const x = partida.x - ((partida.x - fila.esquerda) * (i + 1)) / 5;
      ctx.soltar('rastro', x, fila.y - 20 + (i % 2 ? 6 : -6));
    }
    holo.mover(fila.esquerda + 10, fila.y - 20);

    // Quem ele ultrapassa se assusta na passagem.
    (ctx.efeito.ultrapassados || []).forEach((uid, i) => {
      setTimeout(() => ctx.reagir(uid, 'carta--sacudida', 400), 90 * i);
    });
    // Babuínos espantados: esses vao mesmo embora.
    ctx.alvos.forEach((uid, i) => setTimeout(() => ctx.reagir(uid, 'carta--expulsa', 550), 120 * i));

    await ctx.esperar(500);
    ctx.soltar('onda-choque', fila.esquerda + 10, fila.y);
    await ctx.esperar(220);
    await holo.sumir();
  },

  // Dois lobos alfa na mesma fila: encarada curta e o recem-chegado sai.
  async 'lobo-duelo'(ctx) {
    const fila = ctx.fila();
    const dono = ctx.onde(ctx.efeito.autor) || { x: fila.esquerda, y: fila.y };
    const novo = ctx.onde(ctx.efeito.alvos[0]) || { x: fila.direita, y: fila.y };
    const meio = (dono.x + novo.x) / 2;

    const a = ctx.holo({ x: meio - 46, y: fila.y - 18, escala: 1.05, vira: -1 });
    const b = ctx.holo({
      animal: 'lobo', x: meio + 46, y: fila.y - 18, escala: 1.05, vira: 1,
      cor: ctx.corAlvo, // o lobo que chegou pode ser de outro jogador
    });

    await ctx.esperar(420);
    ctx.soltar('onda-choque', meio, fila.y - 10, { vida: 600 });
    ctx.soltar('etiqueta', meio, fila.y - 96, { texto: 'só há um alfa' });
    ctx.reagir(ctx.efeito.alvos[0], 'carta--expulsa', 600);
    b.mover(meio + 130, fila.y + 30, { escala: 0.6 });
    await ctx.esperar(420);
    await Promise.all([a.sumir(), b.sumir()]);
  },

  // O elefante empurra com peso: cada carta empurrada balanca.
  async elefante(ctx) {
    const fila = ctx.fila();
    const partida = ctx.onde(ctx.efeito.autor) || { x: fila.direita, y: fila.y };
    const holo = ctx.holo({ x: partida.x, y: fila.y - 16, escala: 1.2, vira: -1 });

    await ctx.esperar(260);
    for (let i = 0; i < ctx.alvos.length; i++) {
      const alvo = ctx.onde(ctx.alvos[i]);
      if (alvo) {
        holo.mover(alvo.x, fila.y - 16);
        ctx.reagir(ctx.alvos[i], 'carta--empurrada', 450);
        ctx.soltar('onda-choque', alvo.x, alvo.y, { vida: 520 });
      }
      await ctx.esperar(190);
    }
    await ctx.esperar(160);
    await holo.sumir();
  },

  // O tubarao morde uma vitima de cada vez, na ordem em que comeu de verdade.
  async tubarao(ctx) {
    const fila = ctx.fila();
    const partida = ctx.onde(ctx.efeito.autor) || { x: fila.direita, y: fila.y };
    const holo = ctx.holo({ x: partida.x, y: fila.y - 16, escala: 1.1, vira: -1 });

    await ctx.esperar(220);
    for (const uid of ctx.alvos) {
      const alvo = ctx.onde(uid);
      if (alvo) {
        holo.mover(alvo.x, fila.y - 16);
        await ctx.esperar(150);
        ctx.soltar('mordida', alvo.x, alvo.y, { vida: 400 });
        ctx.reagir(uid, 'carta--mordida', 420);
        await ctx.esperar(230);
      } else {
        await ctx.esperar(120);
      }
    }
    await holo.sumir();
  },

  // A aguia sobrevoa a fila inteira e todo mundo se realinha embaixo dela.
  async aguia(ctx) {
    const fila = ctx.fila();
    const holo = ctx.holo({ x: fila.esquerda, y: fila.y - 74, escala: 1.05, vira: 1 });
    ctx.soltar('circulo-voo', fila.meio, fila.y - 70, { vida: 1100 });

    await ctx.esperar(60);
    holo.mover(fila.direita, fila.y - 74, { vira: 1 });
    await ctx.esperar(520);
    holo.mover(fila.meio, fila.y - 88, { escala: 1.15 });

    ctx.alvos.forEach((uid, i) => setTimeout(() => ctx.reagir(uid, 'carta--realinhada', 500), 70 * i));
    await ctx.esperar(560);
    await holo.sumir();
  },

  // O pavao para, abre o leque e passa na frente.
  async pavao(ctx) {
    const alvo = ctx.onde(ctx.efeito.alvos[0]);
    const fila = ctx.fila();
    const ponto = alvo || { x: fila.meio, y: fila.y };
    const holo = ctx.holo({ x: ponto.x + 40, y: fila.y - 20, escala: 1.05, vira: -1 });

    await ctx.esperar(200);
    ctx.soltar('leque', ponto.x + 40, fila.y - 24, { vida: 900 });
    await ctx.esperar(420);
    ctx.reagir(ctx.efeito.alvos[0], 'carta--espantada', 500);
    holo.mover(ponto.x - 34, fila.y - 20);
    await ctx.esperar(420);
    await holo.sumir();
  },

  // O cavalo se planta no lugar: ele nao age, ele fica.
  async cavalo(ctx) {
    const fila = ctx.fila();
    const dono = ctx.onde(ctx.efeito.autor) || { x: fila.meio, y: fila.y };
    const holo = ctx.holo({ x: dono.x, y: fila.y - 20, escala: 1.05, vira: -1 });
    ctx.soltar('barreira', dono.x - 34, fila.y, { vida: 800 });
    ctx.reagir(ctx.efeito.autor, 'carta--barreira', 520);
    await ctx.esperar(620);
    await holo.sumir();
  },

  // Impasse: alguem tentou passar e bateu no cavalo.
  async bloqueio(ctx) {
    const fila = ctx.fila();
    const cavalo = ctx.onde(ctx.efeito.autor) || { x: fila.meio, y: fila.y };
    const quemTentou = ctx.onde(ctx.efeito.alvos[0]) || { x: cavalo.x + 90, y: fila.y };
    const meio = (cavalo.x + quemTentou.x) / 2;

    const a = ctx.holo({ x: cavalo.x, y: fila.y - 20, escala: 1, vira: 1 });
    const b = ctx.holo({
      animal: ctx.efeito.alvoAnimais?.[0],
      x: quemTentou.x, y: fila.y - 20, escala: 1, vira: -1,
      cor: ctx.corAlvo,
    });

    await ctx.esperar(180);
    ctx.soltar('barreira', meio, fila.y, { vida: 800 });
    ctx.soltar('etiqueta', meio, fila.y - 92, { texto: 'bloqueado' });
    ctx.reagir(ctx.efeito.autor, 'carta--barreira', 500);
    ctx.reagir(ctx.efeito.alvos[0], 'carta--sacudida', 460);
    await ctx.esperar(620);
    await Promise.all([a.sumir(), b.sumir()]);
  },

  // O pinguim vira a fila inteira: um iceberg gangorra embaixo de todo mundo.
  async pinguim(ctx) {
    const fila = ctx.fila();
    const holo = ctx.holo({ x: fila.meio, y: fila.y - 24, escala: 1.05 });
    ctx.soltar('iceberg', fila.meio, fila.y + 12, { vida: 1000 });

    await ctx.esperar(220);
    ctx.alvos.forEach((uid, i) => setTimeout(() => ctx.reagir(uid, 'carta--sacudida', 430), 55 * i));
    holo.mover(fila.meio, fila.y - 34, { escala: 1.15 });
    await ctx.esperar(620);
    await holo.sumir();
  },

  // O polvo VIRA outro bicho. A arte troca no meio de um anel de luz.
  async polvo(ctx) {
    const fila = ctx.fila();
    const dono = ctx.onde(ctx.efeito.autor) || { x: fila.meio, y: fila.y };
    const holo = ctx.holo({ x: dono.x, y: fila.y - 24, escala: 1.05 });

    await ctx.esperar(260);
    ctx.soltar('transformacao', dono.x, fila.y - 24, { vida: 600 });
    await ctx.esperar(240);
    if (ctx.efeito.copiando) holo.trocarArte(ctx.efeito.copiando);
    await ctx.esperar(280);
    // Fica em cena: quem apaga e o 'polvo-volta', depois do poder copiado.
    ctx.guardar('polvo', holo);
  },

  // ...e volta a ser polvo quando o poder copiado termina.
  async 'polvo-volta'(ctx) {
    const holo = ctx.recuperar('polvo');
    if (!holo) return;
    const fila = ctx.fila();
    const dono = ctx.onde(ctx.efeito.autor);
    if (dono) holo.mover(dono.x, fila.y - 24);
    ctx.soltar('transformacao', dono ? dono.x : fila.meio, fila.y - 24, { vida: 600 });
    await ctx.esperar(240);
    holo.trocarArte('polvo');
    await ctx.esperar(320);
    await holo.sumir();
  },

  // Babuíno sozinho: provoca, e nao acontece nada. A piada e essa.
  async 'babuino-solo'(ctx) {
    const fila = ctx.fila();
    const dono = ctx.onde(ctx.efeito.autor) || { x: fila.meio, y: fila.y };
    const holo = ctx.holo({ x: dono.x, y: fila.y - 22, escala: 0.95, vira: -1 });
    await ctx.esperar(260);
    ctx.soltar('etiqueta', dono.x, fila.y - 86, { texto: 'sozinho…' });
    await ctx.esperar(560);
    await holo.sumir();
  },

  // Bando de babuínos: comemoracao, correria ate a frente e os grandoes fora.
  async 'babuino-bando'(ctx) {
    const fila = ctx.fila();
    const bando = (ctx.efeito.bando || [ctx.efeito.autor]).slice(0, 3);
    const holos = bando.map((uid, i) => {
      const p = ctx.onde(uid) || { x: fila.direita - i * 40, y: fila.y };
      return ctx.holo({ x: p.x, y: fila.y - 20 - i * 6, escala: 0.9, vira: -1 });
    });

    // Festa: pipoca de luz saindo do bando.
    for (let i = 0; i < 10; i++) {
      const base = ctx.onde(bando[i % bando.length]) || { x: fila.meio, y: fila.y };
      ctx.soltar('festa', base.x, base.y, {
        vida: 850,
        vars: { '--dx': `${(i % 5) * 18 - 36}px`, '--dy': `${-40 - (i % 4) * 22}px` },
      });
    }

    await ctx.esperar(380);
    // Elefantes e tubaroes expulsos pelo bando.
    ctx.alvos.forEach((uid, i) => {
      setTimeout(() => {
        const alvo = ctx.onde(uid);
        if (alvo) ctx.soltar('onda-choque', alvo.x, alvo.y, { vida: 520 });
        ctx.reagir(uid, 'carta--expulsa', 560);
      }, 130 * i);
    });

    // E a corrida ate a porta.
    holos.forEach((h, i) => h.mover(fila.esquerda + 12 + i * 26, fila.y - 20 - i * 6));
    ctx.soltar('rastro', fila.meio, fila.y - 22);
    await ctx.esperar(640);
    await Promise.all(holos.map((h) => h.sumir()));
  },

  // O coelho pula em arco por cima de quem estava na frente.
  async coelho(ctx) {
    const fila = ctx.fila();
    const partida = ctx.onde(ctx.efeito.autor) || { x: fila.direita, y: fila.y };
    const chegada = ctx.onde(ctx.alvos[0]) || { x: fila.esquerda, y: fila.y };
    const holo = ctx.holo({ x: partida.x, y: fila.y - 18, escala: 0.95, vira: -1 });

    ctx.soltar('sombra-pulo', partida.x, fila.y + fila.altura / 2 - 8, { vida: 700 });
    await ctx.esperar(180);

    // Um arco por pulo: sobe, atravessa, desce.
    const pulos = Math.max(1, ctx.alvos.length);
    for (let i = 0; i < pulos; i++) {
      const alvo = ctx.onde(ctx.alvos[ctx.alvos.length - 1 - i]);
      const destino = alvo ? alvo.x : chegada.x;
      holo.mover(destino, fila.y - 62, { escala: 1.05 });
      await ctx.esperar(230);
      holo.mover(destino, fila.y - 18, { escala: 0.95 });
      ctx.soltar('sombra-pulo', destino, fila.y + fila.altura / 2 - 8, { vida: 600 });
      if (alvo) ctx.reagir(ctx.alvos[ctx.alvos.length - 1 - i], 'carta--sacudida', 380);
      await ctx.esperar(190);
    }
    await holo.sumir();
  },

  // O tucano grita: ondas sonoras ate a vitima.
  async tucano(ctx) {
    const fila = ctx.fila();
    const dono = ctx.onde(ctx.efeito.autor) || { x: fila.direita, y: fila.y };
    const alvo = ctx.onde(ctx.efeito.alvos[0]);
    const holo = ctx.holo({ x: dono.x, y: fila.y - 22, escala: 1, vira: -1 });

    await ctx.esperar(200);
    const destino = alvo || { x: fila.esquerda, y: fila.y };
    for (let i = 0; i < 4; i++) {
      const t = (i + 1) / 5;
      setTimeout(
        () => ctx.soltar('onda-som', dono.x + (destino.x - dono.x) * t, fila.y - 22, { vida: 700 }),
        i * 110
      );
    }
    await ctx.esperar(520);
    ctx.reagir(ctx.efeito.alvos[0], 'carta--expulsa', 560);
    if (alvo) ctx.soltar('onda-choque', alvo.x, alvo.y, { vida: 520 });
    await ctx.esperar(300);
    await holo.sumir();
  },

  // O porco-espinho se enrola e dispara espinhos para os dois lados.
  async porcoespinho(ctx) {
    const fila = ctx.fila();
    const dono = ctx.onde(ctx.efeito.autor) || { x: fila.meio, y: fila.y };
    const holo = ctx.holo({ x: dono.x, y: fila.y - 22, escala: 1 });

    await ctx.esperar(240);
    // Um leque de espinhos em volta dele.
    for (let i = 0; i < 12; i++) {
      ctx.soltar('espinho', dono.x, fila.y - 22, {
        vida: 500,
        vars: { '--angulo': `${i * 30}deg`, '--alcance': '46px' },
      });
    }
    // E um espinho mirado em cada vitima.
    ctx.alvos.forEach((uid, i) => {
      setTimeout(() => {
        const alvo = ctx.onde(uid);
        if (alvo) {
          const angulo = (Math.atan2(alvo.y - (fila.y - 22), alvo.x - dono.x) * 180) / Math.PI;
          ctx.soltar('espinho', dono.x, fila.y - 22, {
            vida: 520,
            vars: { '--angulo': `${angulo}deg`, '--alcance': `${Math.abs(alvo.x - dono.x) / 2}px` },
          });
        }
        ctx.reagir(uid, 'carta--atingida', 420);
        setTimeout(() => ctx.reagir(uid, 'carta--expulsa', 520), 220);
      }, 140 * i);
    });

    await ctx.esperar(560 + 140 * ctx.alvos.length);
    await holo.sumir();
  },
};

// ------------------------------------------------------------ o maestro
//
// Toca os efeitos de UM quadro, um de cada vez. Tres redes de seguranca:
//   1. prazo por efeito  - uma animacao lenta e cortada, nao trava o turno
//   2. orcamento do quadro - a soma tambem tem teto
//   3. try/catch + limpeza - erro em uma animacao nao contamina as outras nem
//      deixa lixo na tela
// Em qualquer um dos tres casos o jogo continua normalmente: o quadro e pintado
// do mesmo jeito, porque quem pinta e o main.js, nao este arquivo.

async function reproduzirEfeitos(efeitos, cores) {
  if (!palco || !efeitos || !efeitos.length || !hologramasLigados()) return;

  const comeco = Date.now();
  for (const efeito of efeitos) {
    if (Date.now() - comeco > HOLO.ORCAMENTO_POR_QUADRO) break;
    const animacao = ANIMACOES[efeito.tipo];
    if (!animacao) continue; // efeito sem coreografia: so nao aparece nada

    const cor = corDe(cores, efeito.dono);
    const ctx = {
      efeito,
      cor,
      corAlvo: corDaCarta((efeito.alvos || [])[0]),
      corDaCarta,
      alvos: efeito.alvos || [],
      onde: ondeEsta,
      fila: areaDaFila,
      esperar: dormir,
      reagir,
      soltar: (classe, x, y, opcoes = {}) => solto(classe, x, y, { cor, ...opcoes }),
      holo: (opcoes = {}) =>
        criarHolo(opcoes.animal || efeito.animal, { cor, ...opcoes }),
      guardar: (chave, valor) => guardados.set(chave, valor),
      recuperar: (chave) => {
        const valor = guardados.get(chave);
        guardados.delete(chave);
        return valor;
      },
    };

    try {
      await Promise.race([animacao(ctx), dormir(HOLO.PRAZO_POR_EFEITO)]);
    } catch (erro) {
      // De proposito: so um aviso. Uma animacao quebrada nao pode parar a partida.
      console.warn('[holograma] falhou, seguindo o jogo:', efeito.tipo, erro);
    }
  }
}

// As classes que este arquivo pode colocar numa carta - e so essas. A lista
// existe para a limpeza nunca encostar em 'carta--mini', que e do layout e nao
// da animacao: apagar aquela ali encolheria as cartas do bar e do ralo.
const REACOES = [
  'carta--alvo',
  'carta--sacudida',
  'carta--empurrada',
  'carta--mordida',
  'carta--expulsa',
  'carta--atingida',
  'carta--espantada',
  'carta--realinhada',
  'carta--barreira',
];

// Chamado sempre que uma jogada termina: nada pode sobrar de um turno pro outro.
function limparPalco() {
  guardados.clear();
  if (palco) palco.innerHTML = '';
  for (const el of document.querySelectorAll('.carta')) el.classList.remove(...REACOES);
}

// Separa os efeitos por quadro. Um efeito que aponta para um quadro que nao
// existe (poder que nao mudou nada e por isso nao virou foto) cai no ultimo.
function efeitosPorQuadro(efeitos, totalDeQuadros) {
  const mapa = new Map();
  for (const efeito of efeitos || []) {
    const i = Math.min(Math.max(efeito.quadro || 0, 0), Math.max(0, totalDeQuadros - 1));
    if (!mapa.has(i)) mapa.set(i, []);
    mapa.get(i).push(efeito);
  }
  return mapa;
}
