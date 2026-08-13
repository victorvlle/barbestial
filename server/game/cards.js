// Os 12 animais do Bar Bestial.
// Cada jogador tem um baralho identico com estes 12 animais, mudando so a cor.
//
// Vocabulario que usamos no codigo inteiro:
//   fila   -> a area de empurra-empurra. Indice 0 = mais perto da porta do bar.
//   bar    -> quem conseguiu entrar (vale ponto)
//   ralo   -> quem foi expulso (a carta "E isso ai")
//
// Campos de cada carta:
//   forca        numero do animal (1 a 12). Desempata e alimenta varios poderes.
//   recorrente   o poder dispara de novo a cada turno, nao so quando a carta e jogada
//   escolha      o poder precisa de uma decisao do jogador (o cliente vai perguntar)
//   poder        texto exibido na interface
//   nota         detalhe de regra que a implementacao precisa respeitar

const ANIMAIS = [
  {
    id: 'gamba',
    nome: 'Gambá',
    forca: 1,
    recorrente: false,
    escolha: null,
    poder: 'Expulsa para o ralo todos os animais das duas espécies mais fortes presentes na fila.',
    nota: 'Nunca expulsa outros gambás. "Espécie", não "carta": se houver dois crocodilos, os dois vão.',
  },
  {
    id: 'papagaio',
    nome: 'Papagaio',
    forca: 2,
    recorrente: false,
    escolha: 'animal',
    poder: 'Manda para o ralo um animal da fila à sua escolha.',
    nota: 'Pode escolher a si mesmo ou animais de qualquer jogador.',
  },
  {
    id: 'canguru',
    nome: 'Canguru',
    forca: 3,
    recorrente: false,
    escolha: 'pular1ou2',
    poder: 'Pula por cima do último animal da fila, ou dos dois últimos, à sua escolha.',
    nota: 'A força dos animais pulados não importa. Se a fila estiver vazia, nada acontece.',
  },
  {
    id: 'macaco',
    nome: 'Macaco',
    forca: 4,
    recorrente: false,
    escolha: null,
    poder: 'Sozinho não faz nada. Ao chegar um segundo macaco, a dupla expulsa todos os hipopótamos e crocodilos da fila e vai para a frente de todos.',
    nota: 'A bagunça é disparada pela chegada do segundo macaco.',
  },
  {
    id: 'camaleao',
    nome: 'Camaleão',
    forca: 5,
    recorrente: false,
    escolha: 'especie',
    poder: 'Copia o poder de uma espécie presente na fila, assumindo também a força dela durante essa ação.',
    nota: 'Só durante a ação copiada. Depois volta a valer 5.',
  },
  {
    id: 'foca',
    nome: 'Foca',
    forca: 6,
    recorrente: false,
    escolha: null,
    poder: 'Inverte a fila inteira: quem estava na porta do bar vai para o fim, e vice-versa.',
    nota: 'Se a inversão colocar a foca à frente de um crocodilo ou hipopótamo, ela sofre as ações deles.',
  },
  {
    id: 'zebra',
    nome: 'Zebra',
    forca: 7,
    recorrente: true,
    escolha: null,
    poder: 'Barreira viva: hipopótamos não a ultrapassam, e crocodilos não a ultrapassam nem a comem.',
    nota: 'É um efeito passivo e permanente enquanto ela estiver na fila.',
  },
  {
    id: 'girafa',
    nome: 'Girafa',
    forca: 8,
    recorrente: true,
    escolha: null,
    poder: 'A cada turno, ultrapassa um animal mais fraco que esteja imediatamente à sua frente.',
    nota: 'No máximo um animal por turno.',
  },
  {
    id: 'cobra',
    nome: 'Cobra',
    forca: 9,
    recorrente: false,
    escolha: null,
    poder: 'Ordena a fila inteira por força: o mais forte encosta na porta do bar.',
    nota: 'Reorganiza tudo de uma vez, incluindo a própria cobra.',
  },
  {
    id: 'crocodilo',
    nome: 'Crocodilo',
    forca: 10,
    recorrente: true,
    escolha: null,
    poder: 'A cada turno, devora todos os animais mais fracos que estejam à sua frente.',
    nota: 'Para imediatamente ao encontrar um animal mais forte ou uma zebra.',
  },
  {
    id: 'hipopotamo',
    nome: 'Hipopótamo',
    forca: 11,
    recorrente: true,
    escolha: null,
    poder: 'A cada turno, empurra e ultrapassa os animais mais fracos rumo à porta do bar.',
    nota: 'Não ultrapassa outro hipopótamo, nem o leão, nem a zebra.',
  },
  {
    id: 'leao',
    nome: 'Leão',
    forca: 12,
    recorrente: false,
    escolha: null,
    poder: 'Expulsa todos os macacos da fila e assume a primeira posição, colado na porta do bar.',
    nota: 'Se já houver um leão na fila, o leão recém-jogado vai direto para o ralo.',
  },
];

// Constantes de regra, para nao ficarem numeros soltos espalhados pelo codigo.
const REGRAS = {
  CARTAS_POR_JOGADOR: 12,
  CARTAS_NA_MAO: 4,
  TAMANHO_MAXIMO_FILA: 5,
  ENTRAM_NO_BAR: 2, // os 2 mais perto da porta
  VAO_PARA_O_RALO: 1, // o ultimo da fila
  MIN_JOGADORES: 2,
  MAX_JOGADORES: 4,
};

// Atalhos uteis para o resto do codigo
const POR_ID = Object.fromEntries(ANIMAIS.map((a) => [a.id, a]));
const buscarAnimal = (id) => POR_ID[id];

module.exports = { ANIMAIS, REGRAS, POR_ID, buscarAnimal };
