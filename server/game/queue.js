// Coracao do jogo: tudo que acontece na fila.
//
// A sequencia oficial do turno tem 5 passos, sempre nesta ordem:
//   1. o jogador poe uma carta no FIM da fila (mais longe da porta do bar)
//   2. executa a acao da carta recem-jogada
//   3. dispara as acoes RECORRENTES (cavalo, pavão, tubarão, elefante),
//      da porta do bar em direcao ao fim da fila
//   4. se a fila tiver 5 animais: os 2 da frente entram no bar, o ultimo vai pro ralo
//   5. o jogador compra uma carta nova (passo 5 fica em gameState.js)
//
// Convencao de indices: fila[0] = colado na porta do bar. Ultimo = recem-chegado.
//
// Decisao de implementacao: a carta recem-jogada NAO repete sua acao no passo 3.
// Ela ja agiu no passo 2; o simbolo de recorrente vale a partir do proximo turno.

const { buscarAnimal, REGRAS } = require('./cards');

// ---------------------------------------------------------------- utilitarios

const forcaDe = (carta) => buscarAnimal(carta.animal).forca;
const nomeDe = (carta) => buscarAnimal(carta.animal).nome;

// Concordancia: "1 animal" / "2 animais".
const plural = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`;

// Cada linha do log e uma lista de PEDACOS. Os pedacos que representam uma carta
// carregam o dono, e a interface pinta so aquele nome com a cor do jogador -
// e assim da para ver de quem era o animal que foi devorado.
const ficha = (carta) => ({ t: nomeDe(carta), dono: carta.dono });
const txt = (t) => ({ t });
const listaDe = (cartas) =>
  cartas.flatMap((c, i) => (i === 0 ? [ficha(c)] : [txt(', '), ficha(c)]));

// dono = quem executou a acao. Numa acao recorrente pode nao ser o jogador da vez.
function registrar(estado, partes, dono = null) {
  estado.log.push({ partes, dono });
}

// ------------------------------------------------------------ efeitos
//
// O log e feito para OLHOS: frases em portugues. Os "efeitos" sao a mesma coisa
// para MAQUINAS: uma anotacao do que cada poder decidiu, com os uids envolvidos.
// A interface usa isso para escolher a animacao certa e saber em quem mirar.
//
// Regra de ouro deste arquivo: anotar NUNCA muda nada. As chamadas ficam DEPOIS
// da decisao do poder, so descrevem o que ja foi decidido. Se apagarmos todas
// elas, o jogo continua identico.
//
// "quadro" e o indice da foto do tabuleiro em que este efeito acontece: o
// cliente reproduz a animacao logo antes de pintar aquele quadro, e assim o
// holograma do tubarao aparece no mesmo instante em que a vitima some da fila.

function anotarEfeito(estado, tipo, carta, alvos = [], extra = {}) {
  if (!estado.efeitos) return; // tabuleiro de simulacao: nao precisa anotar
  estado.efeitos.push({
    tipo,
    autor: carta ? carta.uid : null,
    animal: carta ? carta.animal : null,
    dono: carta ? carta.dono : null,
    alvos: alvos.filter(Boolean).map((c) => c.uid),
    alvoAnimais: alvos.filter(Boolean).map((c) => c.animal),
    quadro: estado.quadros ? estado.quadros.length : 0,
    ...extra,
  });
}

function paraORalo(estado, cartas, partes, dono) {
  const alvos = cartas.filter(Boolean);
  if (alvos.length === 0) return;
  estado.fila = estado.fila.filter((c) => !alvos.includes(c));
  estado.ralo.push(...alvos);
  if (partes) registrar(estado, partes, dono);
}

function moverPara(estado, carta, destino) {
  const i = estado.fila.indexOf(carta);
  if (i < 0 || i === destino) return;
  estado.fila.splice(i, 1);
  estado.fila.splice(destino, 0, carta);
}

// ---------------------------------------------------------------- poderes
// Assinatura de todo poder: (estado, carta, escolha, forca)
// "forca" existe por causa do polvo, que assume a forca da especie copiada.

function poderPorcoEspinho(estado, carta) {
  const alvosPossiveis = estado.fila.filter((c) => c.animal !== 'porcoespinho');
  if (alvosPossiveis.length === 0) return;

  // "as duas especies mais fortes" - cada especie tem uma forca unica,
  // entao a forca serve como identidade da especie.
  const duasMaiores = [...new Set(alvosPossiveis.map(forcaDe))]
    .sort((a, b) => b - a)
    .slice(0, 2);

  const vitimas = alvosPossiveis.filter((c) => duasMaiores.includes(forcaDe(c)));
  anotarEfeito(estado, 'porcoespinho', carta, vitimas);
  paraORalo(
    estado,
    vitimas,
    [ficha(carta), txt(' espetou e mandou pro ralo '), ...listaDe(vitimas), txt('.')],
    carta.dono
  );
}

function poderTucano(estado, carta, escolha) {
  const alvo = estado.fila.find((c) => c.uid === escolha?.alvoUid);
  if (!alvo) return; // escolha invalida: o poder simplesmente nao acontece
  anotarEfeito(estado, 'tucano', carta, [alvo]);
  paraORalo(
    estado,
    [alvo],
    [ficha(carta), txt(' mandou '), ficha(alvo), txt(' pro ralo.')],
    carta.dono
  );
}

function poderCoelho(estado, carta, escolha) {
  const pulos = escolha?.pulos === 2 ? 2 : 1;
  const i = estado.fila.indexOf(carta);
  const destino = Math.max(0, i - pulos);
  if (destino === i) return;
  // Quem o coelho pula: os animais entre o destino e a posicao atual.
  anotarEfeito(estado, 'coelho', carta, estado.fila.slice(destino, i), {
    pulos: i - destino,
  });
  moverPara(estado, carta, destino);
  registrar(
    estado,
    [ficha(carta), txt(` pulou por cima de ${plural(i - destino, 'animal', 'animais')}.`)],
    carta.dono
  );
}

function poderBabuino(estado, carta) {
  // A carta que esta agindo conta como babuíno (importa para o polvo copiando babuíno).
  const ehBabuino = (c) => c.animal === 'babuino' || c === carta;
  if (estado.fila.filter(ehBabuino).length < 2) {
    // Babuíno sozinho nao faz nada - mas a animacao existe: ele provoca e nada acontece.
    anotarEfeito(estado, 'babuino-solo', carta);
    return;
  }

  const vitimas = estado.fila.filter(
    (c) => c.animal === 'elefante' || c.animal === 'tubarao'
  );
  anotarEfeito(estado, 'babuino-bando', carta, vitimas, {
    bando: estado.fila.filter(ehBabuino).map((c) => c.uid),
  });
  paraORalo(estado, vitimas);

  // O babuíno novo vai para a frente; os outros se juntam atras dele em ordem invertida.
  const antigos = estado.fila.filter((c) => ehBabuino(c) && c !== carta);
  const resto = estado.fila.filter((c) => !ehBabuino(c));
  estado.fila = [carta, ...antigos.reverse(), ...resto];

  registrar(
    estado,
    [
      txt('Bando de babuínos assumiu a frente'),
      ...(vitimas.length ? [txt(' e expulsou '), ...listaDe(vitimas)] : []),
      txt('.'),
    ],
    carta.dono
  );
}

function poderPovo(estado, carta, escolha) {
  const especie = escolha?.especie;
  const copiado = buscarAnimal(especie);
  if (!copiado || especie === 'polvo') return;

  // So da para copiar uma especie que esteja na fila.
  const presente = estado.fila.some((c) => c.animal === especie && c !== carta);
  if (!presente) return;

  registrar(estado, [ficha(carta), txt(` virou ${copiado.nome} (força ${copiado.forca}).`)], carta.dono);
  // Duas anotacoes cercam a copia: o polvo VIRA a especie, ela age (os efeitos
  // dela caem no meio), e no fim ele VOLTA a ser polvo.
  anotarEfeito(estado, 'polvo', carta, [], { copiando: especie });
  aplicarPoder(estado, carta, escolha, copiado.forca, especie);
  anotarEfeito(estado, 'polvo-volta', carta, [], { copiando: especie });
}

function poderPinguim(estado, carta) {
  anotarEfeito(estado, 'pinguim', carta, estado.fila.filter((c) => c !== carta));
  estado.fila.reverse();
  registrar(estado, [ficha(carta), txt(' inverteu a fila inteira.')], carta.dono);
}

function poderCavalo(estado, carta) {
  // O cavalo nao age: e uma barreira passiva. Tubarao e elefante o consultam.
  // A anotacao abaixo so existe para a animacao de "plantou-se no lugar", e so
  // no turno em que ele e jogado - repetir isso a cada turno cansaria a vista.
  if (estado && estado.cartaJogada === carta) anotarEfeito(estado, 'cavalo', carta);
}

function poderPavao(estado, carta, escolha, forca) {
  const i = estado.fila.indexOf(carta);
  if (i <= 0) return;
  const frente = estado.fila[i - 1];
  if (forcaDe(frente) >= forca) return; // so ultrapassa quem e mais fraco
  anotarEfeito(estado, 'pavao', carta, [frente]);
  estado.fila[i - 1] = carta;
  estado.fila[i] = frente;
  registrar(estado, [ficha(carta), txt(' passou na frente de '), ficha(frente), txt('.')], carta.dono);
}

function poderAguia(estado, carta) {
  anotarEfeito(estado, 'aguia', carta, estado.fila.filter((c) => c !== carta));
  // Ordenacao estavel: animais de mesma forca mantem a ordem relativa.
  estado.fila.sort((a, b) => forcaDe(b) - forcaDe(a));
  registrar(estado, [ficha(carta), txt(' reorganizou a fila por força.')], carta.dono);
}

function poderTubarao(estado, carta, escolha, forca) {
  const comidos = [];
  let barrado = null;
  while (true) {
    const i = estado.fila.indexOf(carta);
    if (i <= 0) break;
    const frente = estado.fila[i - 1];
    // Para imediatamente diante de um mais forte OU de um cavalo.
    if (frente.animal === 'cavalo' || forcaDe(frente) >= forca) {
      if (frente.animal === 'cavalo') barrado = frente;
      break;
    }
    comidos.push(frente);
    paraORalo(estado, [frente]);
  }
  if (comidos.length) {
    // A ordem de "comidos" e a ordem real das mordidas: de tras para frente.
    anotarEfeito(estado, 'tubarao', carta, comidos);
    registrar(estado, [ficha(carta), txt(' devorou '), ...listaDe(comidos), txt('.')], carta.dono);
  }
  if (barrado) anotarEfeito(estado, 'bloqueio', barrado, [carta]);
}

function poderElefante(estado, carta, escolha, forca) {
  let passou = 0;
  let barrado = null;
  const empurrados = [];
  while (true) {
    const i = estado.fila.indexOf(carta);
    if (i <= 0) break;
    const frente = estado.fila[i - 1];
    // Nao passa outro elefante (forca igual), nem o lobo alfa (mais forte), nem o cavalo.
    if (frente.animal === 'cavalo' || forcaDe(frente) >= forca) {
      if (frente.animal === 'cavalo') barrado = frente;
      break;
    }
    empurrados.push(frente);
    estado.fila[i - 1] = carta;
    estado.fila[i] = frente;
    passou++;
  }
  if (passou) {
    anotarEfeito(estado, 'elefante', carta, empurrados, { passou });
    registrar(
      estado,
      [ficha(carta), txt(` empurrou ${plural(passou, 'animal', 'animais')}.`)],
      carta.dono
    );
  }
  if (barrado) anotarEfeito(estado, 'bloqueio', barrado, [carta]);
}

function poderLobo(estado, carta) {
  // Dois lobos alfa nao cabem na mesma alcateia: o recem-chegado vai pro ralo.
  // Vale tambem para o polvo que virou lobo alfa - enquanto ele age, ELE E um
  // lobo alfa, com a forca e a sorte de um.
  const outroLobo = estado.fila.find((c) => c.animal === 'lobo' && c !== carta);
  const jaTemLobo = Boolean(outroLobo);
  if (jaTemLobo) {
    anotarEfeito(estado, 'lobo-duelo', outroLobo, [carta]);
    paraORalo(
      estado,
      [carta],
      [ficha(carta), txt(' encarou o lobo alfa que já estava na fila e foi expulso pro ralo.')],
      carta.dono
    );
    return;
  }
  const babuinos = estado.fila.filter((c) => c.animal === 'babuino');
  const i = estado.fila.indexOf(carta);
  // Quem o lobo ultrapassa na corrida ate a porta - serve para a animacao mirar.
  const ultrapassados = i > 0 ? estado.fila.slice(0, i) : [];
  anotarEfeito(estado, 'lobo', carta, babuinos, {
    ultrapassados: ultrapassados.map((c) => c.uid),
  });
  paraORalo(estado, babuinos);
  moverPara(estado, carta, 0);
  registrar(
    estado,
    [
      ficha(carta),
      txt(
        ` assumiu a frente${
          babuinos.length ? ` e espantou ${plural(babuinos.length, 'babuíno', 'babuínos')}` : ''
        }.`
      ),
    ],
    carta.dono
  );
}

const PODERES = {
  porcoespinho: poderPorcoEspinho,
  tucano: poderTucano,
  coelho: poderCoelho,
  babuino: poderBabuino,
  polvo: poderPovo,
  pinguim: poderPinguim,
  cavalo: poderCavalo,
  pavao: poderPavao,
  aguia: poderAguia,
  tubarao: poderTubarao,
  elefante: poderElefante,
  lobo: poderLobo,
};

// especie e forca so sao diferentes do padrao quando o polvo esta imitando alguem.
function aplicarPoder(estado, carta, escolha, forca = forcaDe(carta), especie = carta.animal) {
  const poder = PODERES[especie];
  if (poder) poder(estado, carta, escolha, forca);
}

// ---------------------------------------------------------------- passo 3

function acoesRecorrentes(estado, cartaJogada) {
  // Fotografia da ordem no inicio do passo: da porta do bar para o fim da fila.
  const recorrentes = estado.fila.filter(
    (c) => c !== cartaJogada && buscarAnimal(c.animal).recorrente
  );
  for (const carta of recorrentes) {
    if (!estado.fila.includes(carta)) continue; // pode ter sido comido no meio do caminho
    aplicarPoder(estado, carta);
  }
}

// ---------------------------------------------------------------- passo 4

function resolverPorta(estado) {
  if (estado.fila.length < REGRAS.TAMANHO_MAXIMO_FILA) return null;

  const entram = estado.fila.splice(0, REGRAS.ENTRAM_NO_BAR);
  const expulso = estado.fila.pop();

  estado.bar.push(...entram);
  estado.ralo.push(expulso);

  registrar(estado, [
    txt('Entraram no bar: '),
    ...listaDe(entram),
    txt('. Sobrou pro ralo: '),
    ficha(expulso),
    txt('.'),
  ]);
  return { entram, expulso };
}

// ---------------------------------------------------------------- passos 1 a 4

// Uma foto do tabuleiro, so com os uids - e leve o suficiente para mandar varias
// por jogada. O cliente ja tem os dados de cada carta e usa o uid para achar.
function instantaneo(estado) {
  return {
    fila: estado.fila.map((c) => c.uid),
    bar: estado.bar.map((c) => c.uid),
    ralo: estado.ralo.map((c) => c.uid),
  };
}

const mesmoQuadro = (a, b) =>
  a && b &&
  a.fila.join() === b.fila.join() &&
  a.bar.join() === b.bar.join() &&
  a.ralo.join() === b.ralo.join();

function fotografar(estado) {
  const foto = instantaneo(estado);
  // Quadro repetido nao vira pausa na tela: se nada mudou, nao guardamos.
  if (!mesmoQuadro(foto, estado.quadros[estado.quadros.length - 1])) estado.quadros.push(foto);
}

// Guardamos uma foto depois de cada passo do turno. E isso que permite ao cliente
// mostrar o elefante empurrando e SO DEPOIS a porta do bar abrindo, em vez de
// pular direto para o resultado final.
function jogarNaFila(estado, carta, escolha) {
  estado.quadros = [];
  if (estado.efeitos) estado.efeitos = [];
  estado.cartaJogada = carta; // so o cavalo consulta isso, e so para animar

  estado.fila.push(carta); // 1: a carta chega no fim da fila
  fotografar(estado);

  aplicarPoder(estado, carta, escolha); // 2: o poder da carta jogada
  fotografar(estado);

  acoesRecorrentes(estado, carta); // 3: cavalo, pavão, tubarão, elefante
  fotografar(estado);

  const resultado = resolverPorta(estado); // 4: a porta do bar
  fotografar(estado);

  estado.cartaJogada = null;
  return resultado;
}

// Roda uma jogada num tabuleiro DE MENTIRA e devolve so o resultado.
// E o que alimenta a pre-visualizacao: o servidor continua sendo o unico que
// conhece as regras, e o cliente recebe a resposta pronta.
// Seguro porque nenhum poder altera as cartas em si - so reordena listas.
function simularJogada(estado, carta, escolha) {
  const faz_de_conta = {
    fila: [...estado.fila],
    bar: [...estado.bar],
    ralo: [...estado.ralo],
    log: [],
    quadros: [],
    efeitos: null, // simulacao nao anota efeito nenhum: ninguem vai animar isso
  };
  jogarNaFila(faz_de_conta, carta, escolha);
  return {
    fila: faz_de_conta.fila.map((c) => c.uid),
    bar: faz_de_conta.bar.map((c) => c.uid),
    ralo: faz_de_conta.ralo.map((c) => c.uid),
  };
}

module.exports = {
  jogarNaFila,
  simularJogada,
  instantaneo,
  aplicarPoder,
  acoesRecorrentes,
  resolverPorta,
  forcaDe,
  nomeDe,
};
