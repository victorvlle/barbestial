// Liga a pagina ao servidor e controla o fluxo de "jogar uma carta".

const JOGADOR_ID = meuJogadorId();
let salaAtual = null;
let estadoAtual = null;

// Quando a carta escolhida pede uma decisao, guardamos a jogada aqui ate o
// jogador decidir. Nada e enviado ao servidor antes disso.
//   { carta, tipo: 'animal' | 'pular1ou2' | 'especie', dados: {} }
let escolha = null;

// Enquanto a animacao de uma jogada roda, as cartas ficam bloqueadas: clicar no
// meio do movimento confunde o jogador e atrapalha o FLIP.
let animando = false;
let ultimaJogadaVista = -1;
let comemorou = false;
let ultimaSala = null;
let votei = false;

// ------------------------------------------------------------ conexao

socket.on('connect', () => {
  $('conexao').textContent = 'conectado';
  $('conexao').className = 'selo selo--on';
  if (salaAtual) {
    enviar('entrar-sala', { codigo: salaAtual, jogadorId: JOGADOR_ID, nome: meuNome.ler() });
  }
});

socket.on('disconnect', () => {
  $('conexao').textContent = 'reconectando…';
  $('conexao').className = 'selo selo--off';
});

socket.on('sala-atualizada', (sala) => {
  salaAtual = sala.codigo;
  ultimaSala = sala;
  renderizarSala(sala, JOGADOR_ID);
  if (!sala.emPartida) mostrarTela('sala');
  // Se a janela de fim está aberta, atualiza os votos da revanche em tempo real.
  if (!$('fim').classList.contains('escondida') && votei) {
    renderizarVotos(sala, JOGADOR_ID);
  }
});

// Alguém preferiu não jogar de novo: a sala acaba para todo mundo.
socket.on('sala-encerrada', ({ motivo }) => {
  salaAtual = null;
  estadoAtual = null;
  voltarAoMenu(motivo);
});

function voltarAoMenu(mensagem) {
  votei = false;
  comemorou = false;
  ultimaJogadaVista = -1;
  $('fim').classList.add('escondida');
  mostrarTela('entrada');
  avisar('aviso-entrada', mensagem || '');
  document.title = 'Bar Bestial';
}

socket.on('estado-atualizado', async (estado) => {
  estadoAtual = estado;
  escolha = null; // qualquer decisao pendente perde a validade quando a fila muda
  mostrarTela('jogo');

  // So anima quando ha uma jogada nova. Reconexao e primeira carga desenham direto.
  const jogadaNova = estado.jogadas > ultimaJogadaVista && ultimaJogadaVista !== -1;
  ultimaJogadaVista = estado.jogadas;

  if (jogadaNova && estado.quadros?.length > 1) {
    await reproduzirJogada(estado);
  }
  atualizar();

  if (estado.fase === 'terminado' && !comemorou) {
    comemorou = true;
    votei = false;
    $('fim-botoes').classList.remove('escondida');
    $('fim-votos').classList.add('escondida');
    mostrarFimDeJogo(estado);
  }

  // Partida nova (primeira ou revanche): outra música, sorteada da playlist.
  if (estado.fase === 'jogando' && estado.jogadas === 0) {
    comemorou = false;
    votei = false;
    $('fim').classList.add('escondida');
    sortearMusica();
  }
});

// Mostra os passos do turno um a um: a carta chegando, o poder dela, as acoes
// recorrentes e finalmente a porta do bar. Sem isso tudo acontece num piscar.
async function reproduzirJogada(estado) {
  animando = true;
  atualizar(); // trava os cliques imediatamente
  const cores = Object.fromEntries(estado.jogadores.map((j) => [j.id, j.cor]));
  const mapa = mapearCartas(estado);

  for (const quadro of estado.quadros.slice(0, -1)) {
    pintarTabuleiro(quadroDaJogada(quadro, estado), mapa, cores);
    await esperar(PAUSA_ENTRE_QUADROS);
  }
  animando = false;
}

// ------------------------------------------------------------ a jogada

function atualizar() {
  if (!estadoAtual) return;
  const minhaVez = estadoAtual.vezDe === JOGADOR_ID && estadoAtual.fase === 'jogando';

  renderizarJogo(estadoAtual, {
    podeJogar: minhaVez && !escolha && !animando,
    cartaEmEscolha: escolha?.carta,
    emEscolha: Boolean(escolha),
    opcaoDaCarta,
    aoClicarMao: comecarJogada,
    aoEscolherNaFila: (opcao) => concluir(opcao.escolha),
    aoPassarNaMao: espiarJogada,
    aoPassarNaFila: (opcao) => espiarOpcao(opcao.chave),
    aoSairDaCarta: esconderPrevia,
  });

  renderizarEscolha(escolha);
}

// Traduz "clicar nesta carta da fila" para uma decisao concreta, conforme a
// carta que esta sendo jogada. Devolve null quando aquela carta nao e uma
// opcao valida - e assim ela nem fica clicavel.
function opcaoDaCarta(carta, indice, total) {
  if (!escolha || !carta) return null;

  if (escolha.tipo === 'animal') {
    return { rotulo: 'pro ralo', escolha: { alvoUid: carta.uid }, chave: `alvo:${carta.uid}` };
  }

  if (escolha.tipo === 'especie') {
    if (carta.animal === 'camaleao') return null; // camaleão não imita camaleão
    return {
      rotulo: `virar ${CATALOGO[carta.animal]?.nome || ''}`,
      escolha: { especie: carta.animal },
      chave: `especie:${carta.animal}`,
      especie: carta.animal,
    };
  }

  if (escolha.tipo === 'pular1ou2') {
    // O canguru entra no fim da fila e pula os últimos. Clicar na última carta
    // significa pular 1; na penúltima, pular 2.
    const pulos = total - indice;
    if (pulos > 2) return null;
    return { rotulo: `pular ${pulos}`, escolha: { pulos }, chave: `pulos:${pulos}` };
  }
  return null;
}

// Passo 1 do clique: a carta pede alguma decisao?
function comecarJogada(carta) {
  avisar('aviso-jogo', '');
  const tipo = CATALOGO[carta.animal]?.escolha;

  // Sem decisao a tomar, ou sem nenhuma opcao possivel (fila vazia, por exemplo):
  // manda direto. O servidor trata "poder sem alvo" como poder que nao acontece.
  if (!tipo || !temOpcoes(tipo)) return enviarJogada(carta, null);

  escolha = { carta, tipo, dados: {} };
  atualizar();
}

function temOpcoes(tipo) {
  if (estadoAtual.fila.length === 0) return false;
  if (tipo === 'especie') {
    return estadoAtual.fila.some((c) => c.animal !== 'camaleao');
  }
  return true;
}

// O camaleao pode ter duas etapas: escolher a especie e, se ela tambem pedir
// decisao (virou papagaio ou canguru), escolher de novo - sempre clicando numa
// carta da fila.
function concluir(dados) {
  if (dados.especie) {
    escolha.dados.especie = dados.especie;
    const decisaoDaCopia = CATALOGO[dados.especie]?.escolha;
    if (decisaoDaCopia && temOpcoes(decisaoDaCopia)) {
      escolha.tipo = decisaoDaCopia;
      return atualizar();
    }
  }
  enviarJogada(escolha.carta, { ...escolha.dados, ...dados });
}

async function enviarJogada(carta, dadosDaEscolha) {
  escolha = null;
  atualizar();
  const r = await enviar('jogar-carta', { uid: carta.uid, escolha: dadosDaEscolha });
  if (!r.ok) avisar('aviso-jogo', r.erro);
}

function cancelar() {
  escolha = null;
  avisar('aviso-jogo', '');
  atualizar();
}

// ------------------------------------------------------- pré-visualização

// Mostra como a fila ficaria. Os dados ja vieram prontos do servidor dentro de
// estado.previsoes, entao isso e instantaneo: nao ha ida e volta pela rede.
function espiarJogada(carta) {
  if (!preferencias.previaLigada() || animando) return;
  const previsao = estadoAtual.previsoes?.[carta.uid];
  if (!previsao) return;
  desenharPrevia(previsao.padrao);
}

// Durante uma escolha, espiar uma opcao especifica (a vitima do papagaio,
// quantos pulos do canguru, quem o camaleao vai imitar).
function espiarOpcao(chave) {
  if (!preferencias.previaLigada() || !escolha) return;
  const previsao = estadoAtual.previsoes?.[escolha.carta.uid];
  const opcao = previsao?.opcoes?.[chave];
  if (opcao) desenharPrevia(opcao);
}

function desenharPrevia(previsao) {
  const cores = Object.fromEntries(estadoAtual.jogadores.map((j) => [j.id, j.cor]));
  mostrarPrevia(previsao, estadoAtual, mapearCartas(estadoAtual), cores);
}

// ------------------------------------------------------------ instruções

function abrirInstrucoes() {
  $('modal-conteudo').innerHTML = textoDasInstrucoes();
  $('modal').classList.remove('escondida');
}

function fecharModal() {
  $('modal').classList.add('escondida');
}

// ------------------------------------------------------------ botoes

$('btn-criar').addEventListener('click', async () => {
  const nome = $('nome').value.trim();
  if (!nome) return avisar('aviso-entrada', 'Digite seu nome primeiro.');
  meuNome.salvar(nome);
  const r = await enviar('criar-sala', { jogadorId: JOGADOR_ID, nome });
  avisar('aviso-entrada', r.ok ? '' : r.erro);
});

$('btn-entrar').addEventListener('click', async () => {
  const nome = $('nome').value.trim();
  const codigo = $('codigo').value.trim().toUpperCase();
  if (!nome) return avisar('aviso-entrada', 'Digite seu nome primeiro.');
  if (codigo.length !== 4) return avisar('aviso-entrada', 'O código tem 4 caracteres.');
  meuNome.salvar(nome);
  const r = await enviar('entrar-sala', { codigo, jogadorId: JOGADOR_ID, nome });
  avisar('aviso-entrada', r.ok ? '' : r.erro);
});

$('btn-comecar').addEventListener('click', async () => {
  const r = await enviar('iniciar-partida');
  if (!r.ok) avisar('aviso-sala', r.erro);
});

$('btn-cancelar').addEventListener('click', cancelar);
$('btn-instrucoes').addEventListener('click', abrirInstrucoes);
$('btn-ajuda').addEventListener('click', abrirInstrucoes);
$('modal-fechar').addEventListener('click', fecharModal);
$('fim-fechar').addEventListener('click', () => $('fim').classList.add('escondida'));

$('btn-revanche').addEventListener('click', async () => {
  votei = true;
  $('fim-botoes').classList.add('escondida');
  renderizarVotos(ultimaSala, JOGADOR_ID);
  const r = await enviar('revanche', { quer: true });
  if (!r.ok) {
    votei = false;
    $('fim-botoes').classList.remove('escondida');
  }
});

$('btn-sair').addEventListener('click', async () => {
  await enviar('revanche', { quer: false });
  voltarAoMenu('Você saiu da sala.');
});
$('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') fecharModal(); });

function pintarBotaoMudo() {
  const ligada = preferencias.musicaLigada();
  $('btn-mudo').classList.toggle('mudo', !ligada);
  $('btn-mudo').title = ligada ? 'Desligar a música' : 'Ligar a música';
}

$('btn-mudo').addEventListener('click', () => {
  alternarMudo();
  pintarBotaoMudo();
});

$('opt-previa').addEventListener('change', (e) => {
  preferencias.definirPrevia(e.target.checked);
  if (!e.target.checked) esconderPrevia();
});

// Um clique em qualquer lugar fecha o balão do "i" (menos no próprio balão).
document.addEventListener('click', (e) => {
  if (!e.target.closest('#balao') && !e.target.closest('.info')) esconderBalao();
});

$('codigo').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-entrar').click();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('modal').classList.contains('escondida')) return fecharModal();
  if (!$('fim').classList.contains('escondida')) return $('fim').classList.add('escondida');
  esconderBalao();
  if (escolha) cancelar();
});

// ------------------------------------------------------------ inicializacao

carregarCatalogo();
carregarMusica();
pintarBotaoMudo();
$('nome').value = meuNome.ler();
$('opt-previa').checked = preferencias.previaLigada();
mostrarTela('entrada');
