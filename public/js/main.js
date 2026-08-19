// Liga a pagina ao servidor e controla o fluxo de "jogar uma carta".

// Quem eu sou vem da conta (ver conta.js), nao mais de um id sorteado no
// navegador. Comeca vazio: sem login nao ha jogo.
let JOGADOR_ID = null;
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
let relogio = null;

// ------------------------------------------------------------ conexao

socket.on('connect', () => {
  $('conexao').textContent = 'conectado';
  $('conexao').className = 'selo selo--on';
  if (salaAtual) enviar('entrar-sala', { codigo: salaAtual });
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
  carregarRanking(); // voltando ao menu, o ranking vem fresquinho
  clearInterval(relogio);
  $('relogio').classList.add('escondida');
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
  tocarRelogio(estado);
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
//
// A ordem dentro de cada passo importa: primeiro o HOLOGRAMA, depois o quadro.
// O tubarão morde enquanto a vítima ainda está na fila e só então ela some -
// se fosse ao contrário, a carta sumiria e o bicho morderia o vazio.
//
// Se a camada de holograma não existir ou falhar, este laço continua igual: o
// jogo nunca depende dela para andar.
async function reproduzirJogada(estado) {
  animando = true;
  atualizar(); // trava os cliques imediatamente
  const cores = Object.fromEntries(estado.jogadores.map((j) => [j.id, j.cor]));
  const mapa = mapearCartas(estado);

  const porQuadro =
    typeof efeitosPorQuadro === 'function'
      ? efeitosPorQuadro(estado.efeitos, estado.quadros.length)
      : new Map();

  // Devolve true quando alguma coisa foi encenada - o passo seguinte usa isso
  // para encurtar a pausa. Um passo que ja teve holograma nao precisa dos 900ms
  // de respiro: o jogador acabou de ver o que aconteceu, e o turno do proximo
  // nao pode ficar esperando um teatro que ja terminou.
  const encenar = async (i) => {
    if (typeof reproduzirEfeitos !== 'function') return false;
    const doQuadro = porQuadro.get(i);
    if (!doQuadro || !doQuadro.length) return false;
    try {
      await reproduzirEfeitos(doQuadro, cores);
      return true;
    } catch (erro) {
      console.warn('[holograma] quadro sem animação, seguindo o jogo:', erro);
      return false;
    }
  };

  for (let i = 0; i < estado.quadros.length - 1; i++) {
    const encenou = await encenar(i);
    pintarTabuleiro(quadroDaJogada(estado.quadros[i], estado), mapa, cores);
    await esperar(encenou ? PAUSA_CURTA : PAUSA_ENTRE_QUADROS);
  }
  // O último quadro é pintado pelo atualizar() logo depois desta função.
  await encenar(estado.quadros.length - 1);

  if (typeof limparPalco === 'function') limparPalco();
  animando = false;
}

// ------------------------------------------------------------ relógio

// O servidor manda quanto tempo AINDA falta; a contagem regressiva acontece
// aqui. Contar a partir do que sobrou evita depender do relógio do computador
// de cada um estar certo.
function tocarRelogio(estado) {
  clearInterval(relogio);
  const caixa = $('relogio');
  if (!estado.turno || estado.fase !== 'jogando') return caixa.classList.add('escondida');

  let restante = Math.ceil(estado.turno.restanteMs / 1000);
  const pintar = () => {
    $('relogio-num').textContent = Math.max(0, restante);
    caixa.classList.toggle('urgente', restante <= 10);
  };

  caixa.classList.remove('escondida');
  pintar();
  relogio = setInterval(() => {
    restante -= 1;
    pintar();
    if (restante <= 0) clearInterval(relogio);
  }, 1000);
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
    if (carta.animal === 'polvo') return null; // polvo não imita polvo
    return {
      rotulo: `virar ${CATALOGO[carta.animal]?.nome || ''}`,
      escolha: { especie: carta.animal },
      chave: `especie:${carta.animal}`,
      especie: carta.animal,
    };
  }

  if (escolha.tipo === 'pular1ou2') {
    // O coelho entra no fim da fila e pula os últimos. Clicar na última carta
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
    return estadoAtual.fila.some((c) => c.animal !== 'polvo');
  }
  return true;
}

// O polvo pode ter duas etapas: escolher a especie e, se ela tambem pedir
// decisao (virou tucano ou coelho), escolher de novo - sempre clicando numa
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

// Durante uma escolha, espiar uma opcao especifica (a vitima do tucano,
// quantos pulos do coelho, quem o polvo vai imitar).
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

// O nome nao vai mais junto: o servidor ja sabe de quem e o socket.
$('btn-criar').addEventListener('click', async () => {
  const r = await enviar('criar-sala');
  avisar('aviso-entrada', r.ok ? '' : r.erro);
});

$('btn-entrar').addEventListener('click', async () => {
  const codigo = $('codigo').value.trim().toUpperCase();
  if (codigo.length !== 4) return avisar('aviso-entrada', 'O código tem 4 caracteres.');
  const r = await enviar('entrar-sala', { codigo });
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

// ------------------------------------------------------------ menu da partida

function abrirMenu(abrir) {
  $('menu-lista').classList.toggle('escondida', !abrir);
  if (!abrir) return;
  $('menu-musica').textContent = preferencias.musicaLigada() ? 'Desligar a música' : 'Ligar a música';
  $('menu-holo').textContent = preferencias.holoLigado() ? 'Desligar os hologramas' : 'Ligar os hologramas';
}

$('btn-menu').addEventListener('click', (e) => {
  e.stopPropagation();
  abrirMenu($('menu-lista').classList.contains('escondida'));
});

$('menu-instrucoes').addEventListener('click', () => {
  abrirMenu(false);
  abrirInstrucoes();
});

$('menu-musica').addEventListener('click', () => {
  alternarMudo();
  pintarBotaoMudo();
  abrirMenu(false);
});

$('menu-holo').addEventListener('click', () => {
  alternarHologramas(!preferencias.holoLigado());
  abrirMenu(false);
});

// Um lugar so para ligar/desligar: o menu da partida e a caixinha do menu
// inicial mexem na mesma preferencia e ficam sempre de acordo.
function alternarHologramas(ligado) {
  preferencias.definirHolo(ligado);
  $('opt-holo').checked = ligado;
  if (!ligado && typeof limparPalco === 'function') limparPalco();
}

$('menu-sair').addEventListener('click', async () => {
  abrirMenu(false);
  await enviar('sair-sala');
  voltarAoMenu('Você saiu da partida.');
});

// Clicar em qualquer outro lugar fecha o menu.
document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu-jogo')) abrirMenu(false);
});

$('opt-previa').addEventListener('change', (e) => {
  preferencias.definirPrevia(e.target.checked);
  if (!e.target.checked) esconderPrevia();
});

$('opt-holo').addEventListener('change', (e) => alternarHologramas(e.target.checked));

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

$('btn-login').addEventListener('click', entrarComSenha);
$('btn-criar-conta').addEventListener('click', criarConta);
$('btn-esqueci').addEventListener('click', () => irPara('esqueci'));
$('btn-enviar-recuperacao').addEventListener('click', pedirRecuperacao);
$('btn-salvar-senha').addEventListener('click', salvarNovaSenha);
$('btn-voltar-login').addEventListener('click', () => irPara('entrar'));
$('btn-voltar-login-2').addEventListener('click', () => irPara('entrar'));
$('btn-sair-conta').addEventListener('click', sair);

// Faixa de confirmação do e-mail
$('btn-reenviar').addEventListener('click', reenviarConfirmacao);
$('btn-trocar-email').addEventListener('click', () => {
  $('bloco-trocar-email').classList.toggle('escondida');
  $('email-novo').value = (CONTA && CONTA.email) || '';
  $('email-novo').focus();
});
$('btn-salvar-email').addEventListener('click', salvarEmailNovo);

// Enter em cada formulário aciona o botão daquele formulário.
const aoApertarEnter = (campo, botao) =>
  $(campo).addEventListener('keydown', (e) => { if (e.key === 'Enter') $(botao).click(); });
aoApertarEnter('login-senha', 'btn-login');
aoApertarEnter('nova-senha', 'btn-criar-conta');
aoApertarEnter('esqueci-email', 'btn-enviar-recuperacao');
aoApertarEnter('senha-nova', 'btn-salvar-senha');
aoApertarEnter('email-novo', 'btn-salvar-email');

carregarCatalogo();
carregarMusica();
pintarBotaoMudo();
iniciarPalco();
$('opt-previa').checked = preferencias.previaLigada();
$('opt-holo').checked = preferencias.holoLigado();
mostrarTela('entrada');

// Por ultimo: descobre se ja ha uma sessao guardada e decide entre a tela de
// login e o menu. Tudo o que vem antes so prepara a pagina.
iniciarContas();
