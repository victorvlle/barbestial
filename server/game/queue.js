// Coracao do jogo: tudo que acontece na fila.
//
// A sequencia oficial do turno tem 5 passos, sempre nesta ordem:
//   1. o jogador poe uma carta no FIM da fila (mais longe da porta do bar)
//   2. executa a acao da carta recem-jogada
//   3. dispara as acoes RECORRENTES (zebra, girafa, crocodilo, hipopotamo),
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
// "forca" existe por causa do camaleao, que assume a forca da especie copiada.

function poderGamba(estado, carta) {
  const alvosPossiveis = estado.fila.filter((c) => c.animal !== 'gamba');
  if (alvosPossiveis.length === 0) return;

  // "as duas especies mais fortes" - cada especie tem uma forca unica,
  // entao a forca serve como identidade da especie.
  const duasMaiores = [...new Set(alvosPossiveis.map(forcaDe))]
    .sort((a, b) => b - a)
    .slice(0, 2);

  const vitimas = alvosPossiveis.filter((c) => duasMaiores.includes(forcaDe(c)));
  paraORalo(
    estado,
    vitimas,
    [ficha(carta), txt(' fedeu e expulsou '), ...listaDe(vitimas), txt('.')],
    carta.dono
  );
}

function poderPapagaio(estado, carta, escolha) {
  const alvo = estado.fila.find((c) => c.uid === escolha?.alvoUid);
  if (!alvo) return; // escolha invalida: o poder simplesmente nao acontece
  paraORalo(
    estado,
    [alvo],
    [ficha(carta), txt(' mandou '), ficha(alvo), txt(' pro ralo.')],
    carta.dono
  );
}

function poderCanguru(estado, carta, escolha) {
  const pulos = escolha?.pulos === 2 ? 2 : 1;
  const i = estado.fila.indexOf(carta);
  const destino = Math.max(0, i - pulos);
  if (destino === i) return;
  moverPara(estado, carta, destino);
  registrar(
    estado,
    [ficha(carta), txt(` pulou por cima de ${plural(i - destino, 'animal', 'animais')}.`)],
    carta.dono
  );
}

function poderMacaco(estado, carta) {
  // A carta que esta agindo conta como macaco (importa para o camaleao copiando macaco).
  const ehMacaco = (c) => c.animal === 'macaco' || c === carta;
  if (estado.fila.filter(ehMacaco).length < 2) return; // macaco sozinho nao faz nada

  const vitimas = estado.fila.filter(
    (c) => c.animal === 'hipopotamo' || c.animal === 'crocodilo'
  );
  paraORalo(estado, vitimas);

  // O macaco novo vai para a frente; os outros se juntam atras dele em ordem invertida.
  const antigos = estado.fila.filter((c) => ehMacaco(c) && c !== carta);
  const resto = estado.fila.filter((c) => !ehMacaco(c));
  estado.fila = [carta, ...antigos.reverse(), ...resto];

  registrar(
    estado,
    [
      txt('Bando de macacos assumiu a frente'),
      ...(vitimas.length ? [txt(' e expulsou '), ...listaDe(vitimas)] : []),
      txt('.'),
    ],
    carta.dono
  );
}

function poderCamaleao(estado, carta, escolha) {
  const especie = escolha?.especie;
  const copiado = buscarAnimal(especie);
  if (!copiado || especie === 'camaleao') return;

  // So da para copiar uma especie que esteja na fila.
  const presente = estado.fila.some((c) => c.animal === especie && c !== carta);
  if (!presente) return;

  registrar(estado, [ficha(carta), txt(` virou ${copiado.nome} (força ${copiado.forca}).`)], carta.dono);
  aplicarPoder(estado, carta, escolha, copiado.forca, especie);
}

function poderFoca(estado, carta) {
  estado.fila.reverse();
  registrar(estado, [ficha(carta), txt(' inverteu a fila inteira.')], carta.dono);
}

function poderZebra() {
  // A zebra nao age: e uma barreira passiva. Crocodilo e hipopotamo a consultam.
}

function poderGirafa(estado, carta, escolha, forca) {
  const i = estado.fila.indexOf(carta);
  if (i <= 0) return;
  const frente = estado.fila[i - 1];
  if (forcaDe(frente) >= forca) return; // so ultrapassa quem e mais fraco
  estado.fila[i - 1] = carta;
  estado.fila[i] = frente;
  registrar(estado, [ficha(carta), txt(' passou na frente de '), ficha(frente), txt('.')], carta.dono);
}

function poderCobra(estado, carta) {
  // Ordenacao estavel: animais de mesma forca mantem a ordem relativa.
  estado.fila.sort((a, b) => forcaDe(b) - forcaDe(a));
  registrar(estado, [ficha(carta), txt(' reorganizou a fila por força.')], carta.dono);
}

function poderCrocodilo(estado, carta, escolha, forca) {
  const comidos = [];
  while (true) {
    const i = estado.fila.indexOf(carta);
    if (i <= 0) break;
    const frente = estado.fila[i - 1];
    // Para imediatamente diante de um mais forte OU de uma zebra.
    if (frente.animal === 'zebra' || forcaDe(frente) >= forca) break;
    comidos.push(frente);
    paraORalo(estado, [frente]);
  }
  if (comidos.length) {
    registrar(estado, [ficha(carta), txt(' devorou '), ...listaDe(comidos), txt('.')], carta.dono);
  }
}

function poderHipopotamo(estado, carta, escolha, forca) {
  let passou = 0;
  while (true) {
    const i = estado.fila.indexOf(carta);
    if (i <= 0) break;
    const frente = estado.fila[i - 1];
    // Nao passa outro hipopotamo (forca igual), nem o leao (mais forte), nem a zebra.
    if (frente.animal === 'zebra' || forcaDe(frente) >= forca) break;
    estado.fila[i - 1] = carta;
    estado.fila[i] = frente;
    passou++;
  }
  if (passou) {
    registrar(
      estado,
      [ficha(carta), txt(` empurrou ${plural(passou, 'animal', 'animais')}.`)],
      carta.dono
    );
  }
}

function poderLeao(estado, carta) {
  // Dois leoes nao cabem na mesma fila: o recem-chegado vai pro ralo.
  // Vale tambem para o camaleao que virou leao - enquanto ele age, ELE E um leao,
  // com a forca e a sorte de um leao.
  const jaTemLeao = estado.fila.some((c) => c.animal === 'leao' && c !== carta);
  if (jaTemLeao) {
    paraORalo(
      estado,
      [carta],
      [ficha(carta), txt(' encarou o leão que já estava na fila e foi expulso pro ralo.')],
      carta.dono
    );
    return;
  }
  const macacos = estado.fila.filter((c) => c.animal === 'macaco');
  paraORalo(estado, macacos);
  moverPara(estado, carta, 0);
  registrar(
    estado,
    [
      ficha(carta),
      txt(
        ` assumiu a frente${
          macacos.length ? ` e espantou ${plural(macacos.length, 'macaco', 'macacos')}` : ''
        }.`
      ),
    ],
    carta.dono
  );
}

const PODERES = {
  gamba: poderGamba,
  papagaio: poderPapagaio,
  canguru: poderCanguru,
  macaco: poderMacaco,
  camaleao: poderCamaleao,
  foca: poderFoca,
  zebra: poderZebra,
  girafa: poderGirafa,
  cobra: poderCobra,
  crocodilo: poderCrocodilo,
  hipopotamo: poderHipopotamo,
  leao: poderLeao,
};

// especie e forca so sao diferentes do padrao quando o camaleao esta imitando alguem.
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
// mostrar o hipopotamo empurrando e SO DEPOIS a porta do bar abrindo, em vez de
// pular direto para o resultado final.
function jogarNaFila(estado, carta, escolha) {
  estado.quadros = [];

  estado.fila.push(carta); // 1: a carta chega no fim da fila
  fotografar(estado);

  aplicarPoder(estado, carta, escolha); // 2: o poder da carta jogada
  fotografar(estado);

  acoesRecorrentes(estado, carta); // 3: zebra, girafa, crocodilo, hipopotamo
  fotografar(estado);

  const resultado = resolverPorta(estado); // 4: a porta do bar
  fotografar(estado);

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
