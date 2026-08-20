// AS REAÇÕES E O TOCADOR, em dois navegadores de verdade.
// Rode com: node tests/reacoes.js
//
// A parte que importa deste teste é a última: NÃO basta o botão aparecer na
// tela. Duas pessoas entram na mesma sala, uma clica num emoji e o teste
// confere que a OUTRA viu, com o nome de quem mandou. É a única prova de que a
// sincronização existe de verdade.
//
// O resto do arquivo cobre as promessas que o pedido fez:
//   * isto não é chat: nenhum campo de texto na partida
//   * nenhum emoji vira quadradinho (nem o 🫪, que é do Unicode 16)
//   * a reação aparece na hora para quem clicou, sem esperar a rede
//   * várias reações convivem, em vez de uma substituir a outra
//   * elas somem sozinhas
//   * elas não cobrem carta, mão, fila, bar nem ralo
//   * espectador não manda reação, nem forjando o evento pelo console
//   * o servidor recusa qualquer coisa fora da lista
//   * nada disso vira histórico
//   * o tocador diz que festa e que música estão rolando, e mostra que está
//     tocando enquanto se espera

const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { entrarNoJogo, ambienteDeTeste } = require('./ajuda');

const raiz = path.join(__dirname, '..');
const PORTA = 3967;
const url = `http://localhost:${PORTA}`;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let falhas = 0;
const check = (c, m) => { console.log(`${c ? 'ok   ' : 'FALHA'}  ${m}`); if (!c) falhas++; };

// Faixas de teste próprias (tons curtos), para o tocador ter o que tocar.
const pastaDeTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-reacoes-'));
function gerarFaixas() {
  const pasta = path.join(pastaDeTeste, 'edm');
  fs.mkdirSync(pasta, { recursive: true });
  for (let i = 0; i < 3; i++) {
    execFileSync('ffmpeg', [
      '-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${200 + i * 70}:duration=3`,
      '-ac', '1', '-b:a', '64k',
      path.join(pasta, `Faixa ${i + 1} - Artista de Teste.mp3`),
    ]);
  }
}

const servidor = spawn('node', ['server/index.js'], {
  cwd: raiz,
  env: ambienteDeTeste(PORTA, { FESTAS_PASTA: pastaDeTeste }),
});
const encerrar = () => {
  servidor.kill();
  fs.rmSync(pastaDeTeste, { recursive: true, force: true });
};

// Espera uma reação com aquele emoji aparecer na tela da página.
const esperarReacao = (pagina, emoji, limite = 4000) =>
  pagina.waitForFunction(
    (e) => [...document.querySelectorAll('.reacao')].some((r) => r.textContent.includes(e)),
    emoji,
    { timeout: limite }
  ).then(() => true).catch(() => false);

(async () => {
  gerarFaixas();
  await espera(2500);

  // ============================================ 1. a lista mora no servidor
  const lista = await fetch(`${url}/api/reacoes`).then((r) => r.json());
  check(lista.ok && lista.reacoes.length === 31, `o servidor lista os 31 emojis (${lista.reacoes.length})`);
  check(lista.reacoes.includes('🫪'), 'inclusive o 🫪, que é o mais novo de todos');

  const navegador = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const nova = async () => (await navegador.newContext({ viewport: { width: 1366, height: 860 } })).newPage();
  const ana = await nova(), bruno = await nova(), zeca = await nova();
  const erros = [];
  for (const [n, p] of [['Ana', ana], ['Bruno', bruno], ['Zeca', zeca]]) {
    p.on('pageerror', (e) => erros.push(`${n}: ${e.message}`));
  }
  for (const p of [ana, bruno, zeca]) await p.goto(url);
  await espera(500);

  // ============================================ 2. a sala de espera
  await entrarNoJogo(ana, 'AnaR');
  await ana.click('#btn-criar');
  await espera(700);
  const codigo = (await ana.textContent('#codigo-sala')).trim();

  // O tocador na espera: é aqui que a música é "enquanto você espera".
  const naEspera = await ana.evaluate(() => ({
    visivel: !document.getElementById('tocador').classList.contains('escondida'),
    chamada: document.getElementById('tocador-chamada-texto').textContent,
    festa: document.getElementById('tocador-festa').textContent,
    faixa: document.getElementById('tocador-faixa').textContent,
    espera: document.getElementById('tocador').classList.contains('tocador--espera'),
    barras: document.querySelectorAll('#tocador-eq i').length,
    tocando: !audio.paused,
  }));
  check(naEspera.visivel && naEspera.espera, 'na sala de espera o tocador aparece em modo de espera');
  check(/espera/i.test(naEspera.chamada), `com a chamada certa ("${naEspera.chamada.trim()}")`);
  check(/EDM/.test(naEspera.festa), `dizendo qual festa está rolando (${naEspera.festa})`);
  check(naEspera.faixa.includes('—'), `e qual música está tocando (${naEspera.faixa})`);
  check(naEspera.barras === 4, 'o equalizador tem as quatro barrinhas');
  check(naEspera.tocando, 'e a música toca de verdade enquanto se espera');
  await ana.screenshot({ path: path.join(raiz, 'shot-tocador-espera.png') });

  // ============================================ 3. a partida começa
  await entrarNoJogo(bruno, 'BrunoR');
  await bruno.fill('#codigo', codigo);
  await bruno.click('#btn-entrar');
  await espera(500);
  await ana.click('#btn-comecar');
  await espera(1200);

  const naMesa = await ana.evaluate(() => ({
    chamada: document.getElementById('tocador-chamada-texto').textContent.trim(),
    espera: document.getElementById('tocador').classList.contains('tocador--espera'),
    visivel: !document.getElementById('tocador').classList.contains('escondida'),
  }));
  check(naMesa.visivel && !naMesa.espera, 'com a partida rolando o tocador continua, mas discreto');
  check(/tocando|pausado/i.test(naMesa.chamada), `a chamada encolhe (“${naMesa.chamada}”)`);

  // ============================================ 4. não é chat
  const campos = await ana.evaluate(() => {
    const jogo = document.getElementById('tela-jogo');
    return {
      entradas: jogo.querySelectorAll('input:not([type=range]):not([type=checkbox]), textarea, [contenteditable]').length,
      bandeja: document.querySelectorAll('#reacoes-bandeja input, #reacoes-bandeja textarea').length,
    };
  });
  check(campos.entradas === 0, 'não existe campo de texto nenhum na tela da partida');
  check(campos.bandeja === 0, 'nem dentro da bandeja de reações');

  // ============================================ 5. a bandeja
  check(await ana.locator('#btn-reacoes').isVisible(), 'o botão de reações aparece na partida');
  check(await ana.locator('#reacoes-bandeja').isHidden(), 'e a bandeja começa fechada');
  await ana.click('#btn-reacoes');
  await espera(250);
  check(await ana.locator('#reacoes-bandeja').isVisible(), 'clicar abre a bandeja');
  const opcoes = await ana.locator('.reacao-opcao').count();
  check(opcoes === 31, `com os 31 emojis (${opcoes})`);

  const tamanhoBandeja = await ana.locator('#reacoes-bandeja').evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { l: Math.round(r.width), a: Math.round(r.height) };
  });
  check(
    tamanhoBandeja.l < 320 && tamanhoBandeja.a < 320,
    `a bandeja é pequena, não toma a tela (${tamanhoBandeja.l}x${tamanhoBandeja.a})`
  );

  // ============================================ 6. nenhum quadradinho
  //
  // O teste é o mesmo que o jogo usa: desenha o emoji e um caractere que fonte
  // nenhuma tem, e compara. Aqui conferimos o RESULTADO na tela: ou o navegador
  // sabia desenhar, ou entrou o SVG do projeto. Nenhum dos dois é um quadrado.
  const tofus = await ana.evaluate(() =>
    [...document.querySelectorAll('.reacao-opcao')]
      .map((botao) => {
        const caixa = botao.querySelector('.emoji');
        const desenhado = caixa.classList.contains('emoji--desenhado');
        const emoji = botao.dataset.emoji;
        // `temNaFonte` é a função do próprio jogo (js/reacoes.js).
        const fonteTem = temNaFonte(emoji);
        return { emoji, desenhado, fonteTem, ok: fonteTem || desenhado };
      })
      .filter((r) => !r.ok)
  );
  check(tofus.length === 0, `nenhum emoji vira quadradinho ${tofus.length ? JSON.stringify(tofus) : ''}`);

  // E o caso concreto: quando a fonte não tem o 🫪, quem desenha somos nós.
  const novos = await ana.evaluate(() =>
    ['🫪', '🫠'].map((e) => ({
      emoji: e,
      fonteTem: temNaFonte(e),
      temDesenho: Boolean(DESENHOS[codigoDe(e)]),
    }))
  );
  check(
    novos.every((n) => n.fonteTem || n.temDesenho),
    `os emojis novos têm saída garantida ${JSON.stringify(novos)}`
  );
  // Força o caminho do desenho, para provar que o SVG entra mesmo quando a
  // fonte falha - em máquina nenhuma dá para desinstalar a fonte no meio do teste.
  const desenhoEntrou = await ana.evaluate(() => {
    sabidos.set('🫪', false); // finge que a fonte deste sistema não tem
    const caixa = pintarEmoji('🫪');
    sabidos.delete('🫪');
    return { classe: caixa.className, svg: caixa.querySelector('svg') !== null };
  });
  check(
    desenhoEntrou.svg && /desenhado/.test(desenhoEntrou.classe),
    'sem a fonte, o 🫪 entra como desenho nosso (e não trocado por outro emoji)'
  );

  // ============================================ 7. clicou, apareceu na hora
  const relogioDoClique = await ana.evaluate(async () => {
    const antes = performance.now();
    document.querySelector('.reacao-opcao[data-emoji="😂"]').click();
    // Sem esperar a rede: a reação tem que estar no DOM já no próximo quadro.
    await new Promise((r) => requestAnimationFrame(r));
    return { ms: performance.now() - antes, quantas: document.querySelectorAll('.reacao').length };
  });
  check(
    relogioDoClique.quantas === 1 && relogioDoClique.ms < 120,
    `a reação aparece na hora para quem clicou (${Math.round(relogioDoClique.ms)}ms)`
  );
  check(await ana.locator('#reacoes-bandeja').isHidden(), 'e a bandeja se fecha sozinha depois do clique');

  // ============================================ 8. O OUTRO JOGADOR RECEBE
  check(await esperarReacao(bruno, '😂'), 'O OUTRO JOGADOR VÊ A REAÇÃO — a sincronização funciona');

  // O evento que trafega: emoji, quem mandou, o nome e a hora. Escutamos o
  // próximo antes de pedir a reação, para pegar o pacote cru como ele chega.
  const pacote = bruno.evaluate(() => new Promise((pronto) => {
    socket.once('reacao', pronto);
    setTimeout(() => pronto(null), 5000);
  }));
  await espera(650);
  await ana.evaluate(() => document.querySelector('.reacao-opcao[data-emoji="🥳"]').click());
  const cru = await pacote;
  check(
    cru && cru.emoji === '🥳' && cru.jogadorId && cru.nome === 'AnaR' && typeof cru.quando === 'number',
    `o evento leva emoji, jogador, nome e hora ${JSON.stringify(cru)}`
  );
  const noBruno = await bruno.evaluate(() => {
    const r = document.querySelector('.reacao');
    return {
      texto: r.textContent,
      nome: r.querySelector('.reacao-nome').textContent,
      minha: r.classList.contains('reacao--minha'),
      cor: r.style.getPropertyValue('--c'),
    };
  });
  check(noBruno.nome === 'AnaR', `com o nome de quem mandou (${noBruno.nome})`);
  check(!noBruno.minha, 'e marcada como reação dos outros, não dele');
  check(noBruno.cor.includes('--'), `pintada com a cor do jogador na mesa (${noBruno.cor})`);

  // Ninguém vê a mesma reação duas vezes: quem manda ignora o próprio eco.
  const duplicou = await ana.evaluate(() =>
    [...document.querySelectorAll('.reacao')].filter((r) => r.textContent.includes('😂')).length
  );
  check(duplicou === 1, `quem mandou vê a reação uma vez só, não duas (${duplicou})`);

  // ============================================ 9. várias ao mesmo tempo
  //
  // Uma reação não substitui a outra: elas se acumulam e cada uma vive o seu
  // tempo. É o ponto que o pedido chamou de importante.
  const emParalelo = ['🔥', '😡', '❤️', '💀'];
  for (let i = 0; i < emParalelo.length; i++) {
    const quem = i % 2 === 0 ? ana : bruno;
    await quem.evaluate((e) => document.querySelector(`.reacao-opcao[data-emoji="${e}"]`).click(), emParalelo[i]);
    await espera(600); // respeita a trava de ritmo dos dois lados
  }
  await espera(400);
  const juntas = await bruno.evaluate(() =>
    [...document.querySelectorAll('.reacao')].map((r) => ({
      texto: r.querySelector('.emoji').textContent,
      esquerda: Math.round(r.getBoundingClientRect().left),
      nome: r.querySelector('.reacao-nome').textContent,
    }))
  );
  check(juntas.length >= 4, `várias reações convivem na tela ao mesmo tempo (${juntas.length})`);
  check(new Set(juntas.map((j) => j.esquerda)).size > 1, 'e nascem em pontos diferentes, sem empilhar uma na outra');
  check(new Set(juntas.map((j) => j.nome)).size === 2, 'com o nome certo de cada um dos dois jogadores');

  // ============================================ 10. não cobrem o jogo
  const invade = await bruno.evaluate(() => {
    const bate = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    const palco = document.getElementById('reacoes-palco').getBoundingClientRect();
    const alvos = { fila: '#fila', mao: '#mao', bar: '#bar', ralo: '#ralo', registro: '#log' };
    const batidas = [];
    for (const [nome, seletor] of Object.entries(alvos)) {
      const el = document.querySelector(seletor);
      if (el && bate(palco, el.getBoundingClientRect())) batidas.push(nome);
    }
    // E as próprias reações têm que estar dentro do palco.
    const fora = [...document.querySelectorAll('.reacao')].filter((r) => {
      const c = r.getBoundingClientRect();
      return c.top < palco.top - 2 || c.bottom > palco.bottom + 2 || c.left < palco.left - 2 || c.right > palco.right + 2;
    }).length;
    return { batidas, fora };
  });
  check(invade.batidas.length === 0, `a zona das reações não encosta em nada do jogo ${invade.batidas.join(', ')}`);
  check(invade.fora === 0, 'e nenhuma reação escapa da zona');

  await bruno.screenshot({ path: path.join(raiz, 'shot-reacoes.png') });
  await ana.click('#btn-reacoes');
  await espera(250);
  await ana.screenshot({ path: path.join(raiz, 'shot-bandeja.png') });
  await ana.keyboard.press('Escape');

  // ============================================ 11. somem sozinhas
  await espera(3600);
  const sobrou = await bruno.locator('.reacao').count();
  check(sobrou === 0, `as reações somem sozinhas depois de alguns segundos (${sobrou} na tela)`);

  // ============================================ 12. nada vira histórico
  const guardou = await bruno.evaluate(() => ({
    noEstado: JSON.stringify(estadoAtual).includes('reaca'),
    noRegistro: document.getElementById('log').textContent.includes('😂'),
  }));
  check(!guardou.noEstado && !guardou.noRegistro, 'reação não entra no estado da partida nem no registro');

  // ============================================ 13. o servidor manda
  const forjadas = await ana.evaluate(() => {
    const tentar = (emoji) => new Promise((r) => socket.emit('reagir', { emoji }, r));
    return Promise.all([
      tentar('<img src=x onerror=alert(1)>'),
      tentar('quero mandar uma mensagem de texto'),
      tentar('🦁'),
      tentar(''),
    ]);
  });
  check(forjadas.every((r) => !r.ok), 'o servidor recusa qualquer coisa fora da lista - inclusive texto');
  await espera(400);
  const vazou = await bruno.evaluate(() => document.querySelectorAll('.reacao').length);
  check(vazou === 0, 'e nada disso chega na tela de ninguém');

  // A trava de ritmo: um "for" no console não vira chuva de emoji.
  const enxurrada = await ana.evaluate(async () => {
    const respostas = [];
    for (let i = 0; i < 15; i++) {
      respostas.push(await new Promise((r) => socket.emit('reagir', { emoji: '🔥' }, r)));
    }
    return { aceitas: respostas.filter((r) => r.ok).length, recusadas: respostas.filter((r) => !r.ok).length };
  });
  check(
    enxurrada.aceitas <= 6 && enxurrada.recusadas > 0,
    `o servidor segura a enxurrada (${enxurrada.aceitas} aceitas, ${enxurrada.recusadas} recusadas)`
  );
  await espera(300);
  const naTela = await bruno.evaluate(() => document.querySelectorAll('.reacao').length);
  check(naTela <= 12, `e a tela nunca passa do limite de reações simultâneas (${naTela})`);

  // ============================================ 14. espectador não reage
  await entrarNoJogo(zeca, 'ZecaR');
  await zeca.fill('#codigo', codigo);
  await zeca.click('#btn-entrar');
  await espera(900);
  check(await zeca.locator('#tela-jogo').isVisible(), 'quem chega tarde entra como espectador');
  check(await zeca.locator('#btn-reacoes').isHidden(), 'e não ganha o botão de reagir');
  const doEspectador = await zeca.evaluate(() =>
    new Promise((r) => socket.emit('reagir', { emoji: '😂' }, r))
  );
  check(!doEspectador.ok, `nem forjando o evento pelo console: "${doEspectador.erro}"`);
  check(await esperarReacao(ana, '😂', 900) === false, 'e nada aparece na tela dos jogadores');

  // Mas ele VÊ as reações dos outros: faz parte de acompanhar a mesa.
  await espera(4200); // deixa a trava de ritmo da Ana esfriar
  await ana.evaluate(() => document.querySelector('.reacao-opcao[data-emoji="👏🏻"]').click());
  check(await esperarReacao(zeca, '👏🏻'), 'o espectador vê as reações de quem está jogando');

  // ============================================ 15. sair limpa a tela
  await ana.evaluate(() => mostrarTela('entrada'));
  await espera(300);
  check(
    (await ana.locator('.reacao').count()) === 0 && (await ana.locator('#bloco-reacoes').isHidden()),
    'voltar ao menu limpa as reações e leva a zona junto'
  );

  check(erros.length === 0, `nenhum erro de JavaScript ${erros.length ? JSON.stringify(erros.slice(0, 3)) : ''}`);
  await navegador.close();
  encerrar();
  process.exit(falhas ? 1 : 0);
})().catch((e) => {
  console.error('EXPLODIU:', e);
  encerrar();
  process.exit(1);
});
