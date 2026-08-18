// Teste de interface: abre o jogo em dois navegadores de verdade e joga clicando.
//
// Este e opcional e mais pesado que os outros. Para rodar:
//   npm install --save-dev playwright
//   npx playwright install chromium
//   npm run test:ui
//
// Ele pega uma classe de bug que os outros testes nao pegam: erro de CSS,
// botao que nao responde, evento de clique quebrado, erro de JavaScript no
// navegador. Foi assim que descobrimos que .escondida perdia para #tela-jogo.
// As imagens shot-*.png ficam na raiz do projeto depois da execucao.

const { chromium } = require('playwright');
const { entrarNoJogo, ambienteDeTeste } = require('./ajuda');
const { spawn } = require('child_process');
const path = require('path');

const PORTA = 3998;
const url = `http://localhost:${PORTA}`;
const raiz = path.join(__dirname, '..');
const servidor = spawn('node', ['server/index.js'], { cwd: raiz, env: ambienteDeTeste(PORTA) });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let falhas = 0;
const check = (c, m) => { console.log(`${c ? 'ok   ' : 'FALHA'}  ${m}`); if (!c) falhas++; };

(async () => {
  await espera(3000);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // dois navegadores independentes = dois jogadores de verdade
  const ctxA = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const ana = await ctxA.newPage();
  const bruno = await ctxB.newPage();

  const erros = [];
  for (const [nome, p] of [['Ana', ana], ['Bruno', bruno]]) {
    const doYoutube = (t) => /youtube|ytimg|iframe_api|ERR_TUNNEL/i.test(t);
    p.on('pageerror', (e) => !doYoutube(e.message) && erros.push(`${nome}: ${e.message}`));
    p.on('console', (m) => m.type() === 'error' && !doYoutube(m.text()) && erros.push(`${nome} console: ${m.text()}`));
    p.on('requestfailed', (r) => !doYoutube(r.url()) && erros.push(`${nome} falhou: ${r.url()}`));
    p.on('response', (r) => { if (r.status() === 404) erros.push(`${nome} 404: ${r.url()}`); });
  }

  await ana.goto(url);
  await bruno.goto(url);
  await espera(600);

  await entrarNoJogo(ana, 'Ana');
  await ana.click('#btn-criar');
  await espera(400);
  const codigo = (await ana.textContent('#codigo-sala')).trim();
  check(/^[A-Z0-9]{4}$/.test(codigo), `sala criada na tela: ${codigo}`);

  await entrarNoJogo(bruno, 'Bruno');
  await bruno.fill('#codigo', codigo);
  await bruno.click('#btn-entrar');
  await espera(400);
  check((await ana.locator('#lista-jogadores li').count()) === 2, 'Ana vê 2 jogadores na sala');
  await ana.screenshot({ path: path.join(raiz, 'shot-lobby.png') });

  await ana.click('#btn-comecar');
  await espera(500);
  check(await ana.locator('#tela-jogo').isVisible(), 'a mesa apareceu');
  check((await ana.locator('#mao .carta').count()) === 4, 'Ana vê 4 cartas na mão');
  check(/sua vez/i.test(await ana.textContent('#vez')), 'a tela avisa que é a vez da Ana');
  check((await ana.locator('.faixa--minha-vez').count()) === 1, 'a faixa acende avisando a vez dela');
  check((await ana.evaluate(() => document.title)).includes('Sua vez'), 'o título da aba também avisa');
  check((await bruno.textContent('#vez')).includes('Ana'), 'Bruno vê que é a vez da Ana');
  check((await ana.locator('#mao .carta.jogavel').count()) === 4, 'as cartas da Ana estão clicáveis');
  check((await bruno.locator('#mao .carta.jogavel').count()) === 0, 'as do Bruno não (não é a vez dele)');

  // joga cartas ate cair uma que peca decisao, so para fotografar a barra de escolha
  let jogadas = 0, viuEscolha = false;
  const daVez = async () => ((await ana.locator('.faixa--minha-vez').count()) > 0 ? ana : bruno);

  while (jogadas < 14) {
    const p = await daVez();
    // As cartas ficam bloqueadas enquanto a animacao da jogada anterior roda.
    // Esperamos ate voltarem a ficar clicaveis, em vez de desistir na hora.
    try {
      await p.locator('#mao .carta.jogavel').first().waitFor({ state: 'visible', timeout: 8000 });
    } catch {
      break; // acabaram as cartas ou a partida terminou
    }

    await p.locator('#mao .carta.jogavel').first().click();
    await espera(400);

    // O polvo pede duas decisoes seguidas (especie, e depois a decisao da
    // especie copiada). Por isso resolvemos escolhas ate a barra sumir.
    // A decisao agora acontece clicando numa carta da fila, nao em botoes.
    let etapas = 0;
    while (await p.locator('.faixa--decidindo').count() > 0 && etapas < 3) {
      if (!viuEscolha) {
        viuEscolha = true;
        await p.screenshot({ path: path.join(raiz, 'shot-escolha.png') });
        check(true, `pediu decisão: "${(await p.textContent('#vez')).replace(/\s+/g, ' ').trim()}"`);
      }
      await p.locator('#fila .carta.alvo').first().click();
      await espera(400);
      etapas++;
    }

    // deixa a animacao dos quadros terminar antes da proxima jogada
    await espera(2800); // a animacao ficou mais lenta de proposito
    jogadas++;
  }

  check(jogadas >= 10, `${jogadas} jogadas feitas clicando na interface`);
  check((await ana.locator('#fila .carta').count()) > 0, 'há cartas na fila');
  // Depende do sorteio: com porco-espinho, tucano e tubarão em cena a fila as vezes
  // nao chega a 5 tao cedo. O que importa e que cartas ESTAO saindo da fila.
  const bar = Number(await ana.textContent('#contagem-bar'));
  const ralo = Number(await ana.textContent('#contagem-ralo'));
  check(bar + ralo > 0, `cartas já saíram da fila (bar ${bar}, ralo ${ralo})`);
  check((await ana.locator('#log li').count()) > 0, 'o log está sendo preenchido');
  await ana.screenshot({ path: path.join(raiz, 'shot-mesa.png') });

  // a mesma carta tem que ser o MESMO elemento entre quadros, senao o FLIP nao anima
  const persiste = await ana.evaluate(() => {
    const el = document.querySelector('#fila .carta');
    return Boolean(el && el.dataset.uid);
  });
  check(persiste, 'as cartas da fila têm identidade própria (data-uid) para animar');

  check(erros.length === 0, `nenhum erro de JavaScript no navegador ${erros.length ? JSON.stringify(erros.slice(0,3)) : ''}`);

  await browser.close();
  servidor.kill();
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('EXPLODIU:', e); servidor.kill(); process.exit(1); });
