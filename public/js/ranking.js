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

// "3 partidas · 2 vitórias", sem plural errado quando é uma só.
const contar = (quantos, singular, plural) => `${quantos} ${quantos === 1 ? singular : plural}`;

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

  // A barra de cada linha é proporcional a quem está na frente. É o que faz a
  // lista contar uma história de relance: dá para ver a distância entre o
  // primeiro e o resto sem ler número nenhum.
  const maior = Math.max(...ranking.map((j) => j.pontos), 1);

  for (const jogador of ranking) {
    const linha = document.createElement('li');
    linha.className = 'ranking-linha';
    if (jogador.posicao <= 3) linha.classList.add(`ranking-linha--p${jogador.posicao}`);
    // Destaque para quem está olhando: achar a própria posição numa lista longa
    // é a primeira coisa que qualquer pessoa tenta fazer num ranking.
    if (CONTA && jogador.id === CONTA.id) linha.classList.add('ranking-linha--eu');

    // A barra fica atrás do conteúdo, presa na largura proporcional.
    const barra = document.createElement('span');
    barra.className = 'ranking-barra';
    barra.style.width = `${Math.max(6, Math.round((jogador.pontos / maior) * 100))}%`;

    const posicao = document.createElement('span');
    posicao.className = 'ranking-posicao';
    posicao.textContent = MEDALHAS[jogador.posicao - 1] || jogador.posicao;

    const quem = document.createElement('span');
    quem.className = 'ranking-quem';

    const nome = document.createElement('span');
    nome.className = 'ranking-nome';
    // textContent, nunca innerHTML: o nome vem de outra pessoa.
    nome.textContent = jogador.nome;

    const meta = document.createElement('span');
    meta.className = 'ranking-meta';
    meta.textContent =
      `${contar(jogador.partidas, 'partida', 'partidas')} · ` +
      `${contar(jogador.vitorias, 'vitória', 'vitórias')}`;

    quem.append(nome, meta);

    const pontos = document.createElement('span');
    pontos.className = 'ranking-pontos';
    const numero = document.createElement('strong');
    numero.textContent = jogador.pontos;
    const unidade = document.createElement('small');
    unidade.textContent = 'pts';
    pontos.append(numero, unidade);

    linha.append(barra, posicao, quem, pontos);
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
