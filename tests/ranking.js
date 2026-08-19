// Contas e ranking, num navegador de verdade.
// Rode com: node tests/ranking.js
//
// Cobre o que os testes de unidade nao alcancam: a tela de login com os dois
// modos, o cadastro que ja entra jogando, a sessao que sobrevive ao F5, o
// logout, e o painel do ranking - posicao na tela, ordem, e ele se atualizando
// sozinho quando uma partida termina.

// Este arquivo importa as REGRAS de pontuação do servidor (posicionar +
// pontosDaPosicao) para conferir a mesa contra o que de fato aconteceu, em vez
// de chutar um placar. Importar aquele módulo abre um banco; apontamos para a
// memória para não encostar em arquivo nenhum deste computador.
process.env.BANCO_CAMINHO = ':memory:';

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const { criarConta, ambienteDeTeste, entrarNoJogo, emailDeTeste } = require('./ajuda');
const { io } = require('socket.io-client');
const { posicionar, pontosDaPosicao } = require('../server/dados/ranking');

const raiz = path.join(__dirname, '..');
const PORTA = 3993;
const url = `http://localhost:${PORTA}`;
const servidor = spawn('node', ['server/index.js'], { cwd: raiz, env: ambienteDeTeste(PORTA) });

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const pedir = (s, ev, d = {}) => new Promise((r) => s.emit(ev, d, r));
let falhas = 0;
const check = (c, m) => { console.log(`${c ? 'ok   ' : 'FALHA'}  ${m}`); if (!c) falhas++; };

const postar = (rota, corpo, cracha) =>
  fetch(`${url}/api/conta/${rota}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cracha ? { Authorization: `Bearer ${cracha}` } : {}),
    },
    body: JSON.stringify(corpo),
  }).then((r) => r.json());

// Joga uma partida inteira por socket, com N jogadores, e devolve as contas.
// E o mesmo caminho da interface, so que sem clicar - o que interessa aqui e o
// resultado chegar ao ranking, nao o clique.
async function partidaCompleta(quantos, prefixo) {
  const contas = [];
  for (let i = 0; i < quantos; i++) {
    const nome = `${prefixo}${i + 1}`;
    const conta = await criarConta(url, nome);
    const socket = io(url, { auth: { token: conta.token } });
    await new Promise((pronto, erro) => {
      socket.once('connect', pronto);
      socket.once('connect_error', erro);
    });
    contas.push({ ...conta.usuario, nomeDeTeste: nome, socket });
  }

  const estados = new Map();
  contas.forEach((c) => c.socket.on('estado-atualizado', (e) => estados.set(c.id, e)));

  const criada = await pedir(contas[0].socket, 'criar-sala');
  for (const c of contas.slice(1)) await pedir(c.socket, 'entrar-sala', { codigo: criada.sala.codigo });
  await pedir(contas[0].socket, 'iniciar-partida');
  await espera(300);

  // A escolha que cada carta exige, igual ao que main.js monta.
  const escolhaPara = (carta, estado) => {
    if (estado.fila.length === 0) return null;
    if (carta.animal === 'tucano') return { alvoUid: estado.fila[0].uid };
    if (carta.animal === 'coelho') return { pulos: 1 };
    if (carta.animal === 'polvo') {
      const especies = [...new Set(estado.fila.map((c) => c.animal))].filter((e) => e !== 'polvo');
      if (!especies.length) return null;
      const dados = { especie: especies[0] };
      if (especies[0] === 'tucano') dados.alvoUid = estado.fila[0].uid;
      if (especies[0] === 'coelho') dados.pulos = 1;
      return dados;
    }
    return null;
  };

  let voltas = 0;
  while (voltas < 12 * quantos + 5) {
    const algum = estados.get(contas[0].id);
    if (!algum || algum.fase === 'terminado') break;
    const daVez = contas.find((c) => c.id === algum.vezDe);
    const visao = estados.get(daVez.id);
    const mao = visao.jogadores.find((j) => j.id === daVez.id).mao;
    if (!mao || !mao.length) break;
    const carta = mao[0];
    const r = await pedir(daVez.socket, 'jogar-carta', {
      uid: carta.uid,
      escolha: escolhaPara(carta, visao),
    });
    if (!r.ok) break;
    await espera(20);
    voltas++;
  }

  const final = estados.get(contas[0].id);
  await espera(400); // o servidor grava o resultado logo depois de avisar
  contas.forEach((c) => c.socket.disconnect());
  return { contas, final };
}

const buscarRanking = () => fetch(`${url}/api/ranking`).then((r) => r.json());

(async () => {
  await espera(2500);

  // ================================================== 1. as rotas de conta
  const config = await fetch(`${url}/api/conta/config`).then((r) => r.json());
  check(config.ok, 'o servidor diz como dá para entrar');
  // O que sai daqui é público por natureza. A checagem é por lista fechada:
  // qualquer campo novo que alguém adicione sem pensar faz este teste falhar.
  // NENHUM segredo pode passar por esta porta.
  check(
    JSON.stringify(Object.keys(config).sort()) === JSON.stringify(['ok', 'senhaMinima']),
    `a configuração pública só tem campos públicos (${Object.keys(config).join(', ')})`
  );

  const semSessao = await fetch(`${url}/api/conta/eu`);
  check(semSessao.status === 401, 'sem crachá, /api/conta/eu responde 401');

  const tokenFalso = await fetch(`${url}/api/conta/eu`, {
    headers: { Authorization: 'Bearer inventado.123.abc' },
  });
  check(tokenFalso.status === 401, 'crachá inventado também é recusado');

  // ================================================== 2. a tela, ainda vazia
  const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const contexto = await navegador.newContext({ viewport: { width: 1366, height: 800 } });
  const pagina = await contexto.newPage();

  const erros = [];
  const doYoutube = (t) => /youtube|ytimg|iframe_api|ERR_TUNNEL/i.test(t);
  pagina.on('pageerror', (e) => !doYoutube(e.message) && erros.push(e.message));

  await pagina.goto(url);
  await espera(700);

  check(await pagina.locator('#tela-login').isVisible(), 'a tela de login aparece para quem não entrou');
  // O estado vazio precisa ser conferido AGORA, antes de qualquer partida.
  check(
    (await pagina.textContent('#ranking-lista')).includes('Nenhuma partida'),
    'sem partidas na semana, o painel explica em vez de ficar vazio'
  );
  check(
    !(await pagina.locator('#btn-criar').isEnabled().catch(() => false)) ||
      (await pagina.locator('#tela-login').isVisible()),
    'o menu do jogo fica atrás da tela de login'
  );

  // Dois modos, e a tela troca entre eles.
  await pagina.click('.aba[data-modo="criar"]');
  check(await pagina.locator('#modo-criar').isVisible(), 'a aba "Criar conta" abre o formulário de cadastro');
  check(
    await pagina.locator('#novo-email').isVisible(),
    'e o e-mail é campo obrigatório do cadastro, na frente do apelido'
  );
  await pagina.click('.aba[data-modo="entrar"]');
  check(await pagina.locator('#modo-entrar').isVisible(), 'e a aba "Entrar" volta para o login');

  // NADA de e-mail na tela: o jogo não manda e-mail nenhum, então prometer
  // link seria mentira. Este teste existe para isso não voltar sem querer.
  check(
    (await pagina.locator('#tela-login').count()) === 1 &&
      (await pagina.locator('#modo-esqueci, #modo-redefinir, #btn-esqueci').count()) === 0,
    'não há "esqueci minha senha" nem tela de link por e-mail'
  );

  // ============================ 3. cadastro entra jogando e já pontua
  //
  // Antes, a pontuação só valia depois de confirmar o e-mail por link. Como o
  // jogo não manda mais e-mail, isso viraria um ranking eternamente vazio.
  const recemChegado = await partidaCompleta(2, 'Novato');
  check(recemChegado.final.fase === 'terminado', 'duas contas recém-criadas jogam normalmente');

  let tabela = await buscarRanking();
  check(
    recemChegado.contas.every((c) => tabela.ranking.find((l) => l.id === c.id)),
    'e aparecem no ranking na hora, sem confirmar nada'
  );

  const semRota = await fetch(`${url}/api/conta/verificar?t=qualquer`);
  const respostaDaRota = await semRota.text();
  check(
    !respostaDaRota.includes('verificado=1'),
    'a rota de confirmação por link não existe mais'
  );

  // ================================================== 6. login pela tela
  await entrarNoJogo(pagina, 'Victor');
  check(!(await pagina.locator('#tela-login').isVisible()), 'depois de criar a conta pela tela, entra no jogo');
  check((await pagina.textContent('#quem-sou')).trim() === 'Victor', 'a tela mostra quem está jogando');

  // O menu abre limpo: nenhuma faixa pedindo confirmação de e-mail.
  check(
    (await pagina.locator('#faixa-email').count()) === 0,
    'nenhuma faixa de confirmação sobrou na tela'
  );
  check(await pagina.locator('#btn-criar').isEnabled(), 'e dá para criar sala na hora');

  // Recarregar não pede login de novo: é a sessão fazendo o trabalho dela.
  await pagina.reload();
  await espera(1200);
  check(!(await pagina.locator('#tela-login').isVisible()), 'a sessão sobrevive ao F5');
  check((await pagina.textContent('#quem-sou')).trim() === 'Victor', 'e continua sendo a mesma conta');

  const denovo = await postar('entrar', { nome: 'Victor', senha: 'senha-de-teste' });
  check(denovo.ok, 'dá para entrar de novo na conta já criada');
  const peloEmail = await postar('entrar', { nome: emailDeTeste('Victor'), senha: 'senha-de-teste' });
  check(peloEmail.ok, 'e também pelo e-mail, no lugar do apelido');

  const eu = await fetch(`${url}/api/conta/eu`, {
    headers: { Authorization: `Bearer ${denovo.token}` },
  }).then((r) => r.json());
  check(eu.ok && eu.usuario.nome === 'Victor', 'o crachá identifica a conta certa');

  // ================================================== 7. o painel do ranking
  check(await pagina.locator('#ranking').isVisible(), 'o painel do ranking aparece na tela principal');
  const lugar = await pagina.evaluate(() => {
    const r = document.querySelector('#ranking').getBoundingClientRect();
    const p = document.querySelector('#tela-entrada .painel').getBoundingClientRect();
    return {
      aEsquerda: r.right <= p.left + 1,
      dentroDaTela: r.left >= -1 && r.right <= innerWidth + 1,
      largura: Math.round(r.width),
      altura: Math.round(r.height),
      centroDaTela: Math.round(r.top + r.height / 2),
      metadeDaJanela: Math.round(innerHeight / 2),
    };
  });
  check(lugar.aEsquerda, 'o ranking fica à ESQUERDA do painel, sem cobrir nada');
  check(lugar.dentroDaTela, `e cabe na tela (${lugar.largura}px de largura)`);
  check(lugar.largura >= 340, `é uma lista larga, não uma coluninha (${lugar.largura}px)`);
  check(
    Math.abs(lugar.centroDaTela - lugar.metadeDaJanela) < 90,
    'e fica centralizado na vertical, na altura dos olhos'
  );

  // ============================ o visual da lista
  // O ranking é o que faz alguém querer jogar mais uma. Estas checagens são de
  // legibilidade, não de gosto: nome grande o suficiente para ler de longe,
  // pontos em destaque, e a barra proporcional que mostra a distância entre as
  // pessoas sem precisar comparar números.
  await pagina.reload();
  await espera(1200);
  const visual = await pagina.evaluate(() => {
    const primeira = document.querySelector('.ranking-linha');
    if (!primeira) return null;
    const nome = primeira.querySelector('.ranking-nome');
    const pontos = primeira.querySelector('.ranking-pontos strong');
    const barra = primeira.querySelector('.ranking-barra');
    const meta = primeira.querySelector('.ranking-meta');
    return {
      alturaDaLinha: Math.round(primeira.getBoundingClientRect().height),
      tamanhoDoNome: parseFloat(getComputedStyle(nome).fontSize),
      tamanhoDosPontos: parseFloat(getComputedStyle(pontos).fontSize),
      temBarra: Boolean(barra) && barra.style.width.endsWith('%'),
      meta: meta ? meta.textContent : '',
      medalha: primeira.querySelector('.ranking-posicao').textContent,
    };
  });
  check(Boolean(visual), 'a lista tem gente para desenhar');
  check(visual && visual.alturaDaLinha >= 44, `cada linha tem corpo (${visual && visual.alturaDaLinha}px de altura)`);
  check(visual && visual.tamanhoDoNome >= 15, `o nome é grande o suficiente (${visual && visual.tamanhoDoNome}px)`);
  check(
    visual && visual.tamanhoDosPontos > visual.tamanhoDoNome,
    'e os pontos são o número que mais salta aos olhos'
  );
  check(visual && visual.temBarra, 'cada linha tem a barra proporcional aos pontos do líder');
  check(visual && /partida/.test(visual.meta), `com partidas e vitórias embaixo do nome ("${visual && visual.meta}")`);
  check(visual && visual.medalha === '🥇', 'e o primeiro lugar leva a medalha de ouro');

  // ============================== 8, 9, 10. as mesas de 2, 3 e 4
  //
  // O placar de uma partida real depende do baralho, então não dá para fixar
  // "5, 3, 2, 1" na marra: uma mesa pode terminar empatada, e a regra manda os
  // empatados dividirem a posição (dois primeiros levam 5 cada, e o próximo é
  // o 3º lugar). Em vez de chutar, conferimos o que o RANKING gravou contra a
  // classificação que a partida realmente produziu.
  async function conferirMesa(quantos, prefixo) {
    const partida = await partidaCompleta(quantos, prefixo);
    check(partida.final.fase === 'terminado', `a partida de ${quantos} jogadores terminou`);

    const classificados = posicionar(partida.final.resultado.tabela);
    const esperado = new Map(
      classificados.map((l) => [l.id, pontosDaPosicao(l.posicao, quantos)])
    );

    tabela = await buscarRanking();
    const conferidos = partida.contas.map((c) => {
      const linha = tabela.ranking.find((l) => l.id === c.id);
      return { nome: c.nomeDeTeste, obtido: linha ? linha.pontos : null, esperado: esperado.get(c.id) };
    });

    const houveEmpate = classificados.length !== new Set(classificados.map((l) => l.posicao)).size;
    check(
      conferidos.every((c) => c.obtido === c.esperado),
      `mesa de ${quantos}: cada um levou os pontos da sua posição` +
        `${houveEmpate ? ' (com empate, dividindo a posição)' : ''} — ` +
        conferidos.map((c) => `${c.nome}: ${c.obtido}`).join(', ')
    );
    return conferidos;
  }

  const dupla = await conferirMesa(2, 'Dupla');
  check(
    dupla.map((c) => c.esperado).sort().join() === '0,1' ||
      dupla.map((c) => c.esperado).join() === '1,1',
    `mesa de 2 usa a tabela [1, 0] (foi ${dupla.map((c) => c.obtido).join(' e ')})`
  );

  const trio = await conferirMesa(3, 'Trio');
  check(
    trio.every((c) => [0, 1, 2].includes(c.obtido)),
    `mesa de 3 usa a tabela [2, 1, 0] (foi ${trio.map((c) => c.obtido).join(', ')})`
  );

  const quarteto = await conferirMesa(4, 'Quarteto');
  check(
    quarteto.every((c) => [0, 1, 2, 3, 5].includes(c.obtido)),
    `mesa de 4 usa a tabela [5, 3, 2, 1] (foi ${quarteto.map((c) => c.obtido).join(', ')})`
  );

  // ================================================== 11. atualiza sozinho
  // A página está aberta desde antes de qualquer partida. Se o painel mostra os
  // jogadores agora, é porque o servidor avisou e ela se redesenhou sozinha -
  // ninguém recarregou nada.
  await espera(600);
  const noPainel = await pagina.locator('#ranking-lista .ranking-linha').count();
  check(noPainel >= 4, `o painel se atualizou sozinho durante as partidas (${noPainel} jogadores)`);

  const primeiro = await pagina.locator('.ranking-linha').first().textContent();
  check(/\d+\s*pts/.test(primeiro), `o painel mostra os pontos ("${primeiro.trim()}")`);
  check(
    (await pagina.locator('#ranking-periodo').textContent()).trim().length > 0,
    'e o período da semana'
  );

  // Ordenado do maior para o menor?
  const pontosNaTela = await pagina.locator('.ranking-pontos').allTextContents();
  const numeros = pontosNaTela.map((t) => Number(t.replace(/\D/g, '')));
  check(
    numeros.every((n, i) => i === 0 || numeros[i - 1] >= n),
    `o ranking está em ordem decrescente (${numeros.join(', ')})`
  );

  // Rolagem quando a lista cresce: o painel não pode esticar para fora da tela.
  const rolagem = await pagina.evaluate(() => {
    const l = document.querySelector('#ranking-lista');
    return { rola: getComputedStyle(l).overflowY, cabe: l.getBoundingClientRect().bottom <= innerHeight + 1 };
  });
  check(rolagem.rola === 'auto' || rolagem.rola === 'scroll', 'a lista rola quando cresce');
  check(rolagem.cabe, 'o painel não vaza para fora da tela');

  await pagina.screenshot({ path: path.join(raiz, 'shot-ranking.png') });

  // ================================================== 12. virada de semana
  // A semana passada tem que continuar consultável, e a atual não pode herdar
  // ponto nenhum dela.
  const semanas = await fetch(`${url}/api/ranking/semanas`).then((r) => r.json());
  check(semanas.ok && semanas.semanas.length >= 1, 'o histórico de semanas existe');

  const outraSemana = await fetch(`${url}/api/ranking?semana=1999-S01`).then((r) => r.json());
  check(outraSemana.ok && outraSemana.ranking.length === 0, 'uma semana sem partidas vem vazia');
  check(tabela.ranking.length > 0, 'enquanto a semana atual continua com os pontos desta semana');

  // ================================================== 13. logout
  await pagina.click('#btn-sair-conta');
  await espera(500);
  check(await pagina.locator('#tela-login').isVisible(), 'o logout leva de volta para a tela de login');
  await pagina.reload();
  await espera(1200);
  check(
    await pagina.locator('#tela-login').isVisible(),
    'e depois do logout o F5 não entra de novo sozinho'
  );

  check(erros.length === 0, `nenhum erro de JavaScript ${erros.length ? JSON.stringify(erros.slice(0, 3)) : ''}`);
  await navegador.close();

  // ============================== 15. o freio de tentativas (por último)
  // Este teste TRANCA o IP de propósito, então fica no fim: nada depois dele
  // depende de conseguir entrar.
  let travou = false;
  for (let i = 0; i < 14; i++) {
    const r = await postar('entrar', { nome: 'NaoExiste', senha: 'chute' });
    if (/Muitas tentativas/.test(r.erro || '')) { travou = true; break; }
  }
  check(travou, 'o freio bloqueia quem fica chutando senha');

  servidor.kill();
  process.exit(falhas ? 1 : 0);
})().catch((e) => {
  console.error('EXPLODIU:', e);
  servidor.kill();
  process.exit(1);
});
