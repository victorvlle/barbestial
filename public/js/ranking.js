// O painel do ranking da semana.
//
// Duas maneiras de ele se atualizar:
//   * ao abrir a pagina e ao voltar para o menu, buscando /api/ranking
//   * na hora, quando o servidor avisa que uma partida acabou
// A segunda e o que faz o ranking mexer sozinho enquanto voce olha para ele.
//
// Este arquivo nao calcula pontuacao nenhuma - ele desenha o que o servidor
// mandou. A conta de quantos pontos vale cada posicao mora em
// server/dados/ranking.js, longe do navegador.

const MEDALHAS = ['🥇', '🥈', '🥉'];

// "11 a 17 de agosto" - o periodo da semana em portugues, sem repetir o mes
// quando ele e o mesmo nos dois extremos.
function periodoDaSemana(semana) {
  if (!semana || !semana.inicio) return '';
  const opcoes = { day: 'numeric', month: 'long', timeZone: 'UTC' };
  // O servidor manda instantes em UTC; deslocamos pelo fuso combinado para que
  // "segunda" apareca como a segunda de quem joga, e nao a de Londres.
  const desloca = (t) => new Date(t + (semana.fusoMinutos || 0) * 60 * 1000);
  const de = desloca(semana.inicio);
  const ate = desloca(semana.fim);
  const mesmoMes = de.getUTCMonth() === ate.getUTCMonth();

  const dia = (d) =>
    mesmoMes ? d.getUTCDate() : d.toLocaleDateString('pt-BR', opcoes);
  return mesmoMes
    ? `${de.getUTCDate()} a ${ate.toLocaleDateString('pt-BR', opcoes)}`
    : `${dia(de)} a ${dia(ate)}`;
}

function desenharRanking({ semana, ranking }) {
  const lista = $('ranking-lista');
  $('ranking-periodo').textContent = periodoDaSemana(semana);
  lista.innerHTML = '';

  if (!ranking || ranking.length === 0) {
    const vazio = document.createElement('li');
    vazio.className = 'ranking-vazio';
    vazio.textContent = 'Nenhuma partida esta semana. Jogue a primeira!';
    lista.appendChild(vazio);
    return;
  }

  for (const jogador of ranking) {
    const linha = document.createElement('li');
    linha.className = 'ranking-linha';
    // Destaque para quem está olhando: achar a própria posição numa lista longa
    // é a primeira coisa que qualquer pessoa tenta fazer num ranking.
    if (CONTA && jogador.id === CONTA.id) linha.classList.add('ranking-linha--eu');

    const posicao = document.createElement('span');
    posicao.className = 'ranking-posicao';
    posicao.textContent = MEDALHAS[jogador.posicao - 1] || `${jogador.posicao}.`;

    const nome = document.createElement('span');
    nome.className = 'ranking-nome';
    // textContent, nunca innerHTML: o nome vem de outra pessoa.
    nome.textContent = jogador.nome;
    nome.title = `${jogador.partidas} partida(s), ${jogador.vitorias} vitória(s)`;

    const pontos = document.createElement('span');
    pontos.className = 'ranking-pontos';
    pontos.textContent = `${jogador.pontos} pts`;

    linha.append(posicao, nome, pontos);
    lista.appendChild(linha);
  }
}

async function carregarRanking() {
  const r = await pedir('/api/ranking');
  if (r.ok) desenharRanking(r);
}

// O servidor avisa a todo mundo quando uma partida termina. Nao importa em que
// tela a pessoa esteja: o painel se atualiza sozinho.
socket.on('ranking-atualizado', desenharRanking);
