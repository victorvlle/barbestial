// Espectador, relógio do turno e contador do baralho, no navegador.
const { chromium } = require('playwright');
const { entrarNoJogo, ambienteDeTeste } = require('./ajuda');
const { spawn } = require('child_process');
const path = require('path');
const raiz = path.join(__dirname, '..');
const PORTA = 3986, url = `http://localhost:${PORTA}`;
const s = spawn('node', ['server/index.js'], { cwd: raiz, env: ambienteDeTeste(PORTA) });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let falhas = 0;
const check = (c, m) => { console.log(`${c ? 'ok   ' : 'FALHA'}  ${m}`); if (!c) falhas++; };

(async () => {
  await espera(2500);
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const nova = async () => (await b.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  const ana = await nova(), bruno = await nova(), zeca = await nova();
  const erros = [];
  const doYoutube = (t) => /youtube|ytimg|iframe_api|ERR_TUNNEL/i.test(t);
  for (const [n, p] of [['Ana', ana], ['Bruno', bruno], ['Zeca', zeca]]) {
    p.on('pageerror', (e) => !doYoutube(e.message) && erros.push(`${n}: ${e.message}`));
  }
  for (const p of [ana, bruno, zeca]) await p.goto(url);
  await espera(600);

  await entrarNoJogo(ana, 'Ana'); await ana.click('#btn-criar'); await espera(500);
  const cod = (await ana.textContent('#codigo-sala')).trim();
  await entrarNoJogo(bruno, 'Bruno'); await bruno.fill('#codigo', cod);
  await bruno.click('#btn-entrar'); await espera(400);
  await ana.click('#btn-comecar'); await espera(900);

  // relógio e baralho
  check(await ana.locator('#relogio').isVisible(), 'o relógio do turno aparece');
  const t1 = Number(await ana.textContent('#relogio-num'));
  check(t1 >= 30 && t1 <= 35, `começa em ${t1} segundos`);
  await espera(2500);
  const t2 = Number(await ana.textContent('#relogio-num'));
  check(t2 < t1, `e conta para baixo (${t1} → ${t2})`);

  const baralho = await ana.textContent('#baralho');
  check(/8 cartas/.test(baralho), `mostra quanto falta comprar: "${baralho.trim()}"`);

  // Zeca chega com a partida rolando: vira espectador
  await entrarNoJogo(zeca, 'Zeca'); await zeca.fill('#codigo', cod);
  await zeca.click('#btn-entrar'); await espera(800);

  check(await zeca.locator('#tela-jogo').isVisible(), 'quem chega tarde cai direto na mesa');
  check((await zeca.textContent('#vez')).includes('ASSISTINDO'), 'e vê que está assistindo');
  check(await zeca.locator('.bloco--mao').isHidden(), 'espectador não tem bloco de mão');
  const larguraLog = await zeca.locator('.bloco--log').evaluate((e) => Math.round(e.getBoundingClientRect().width));
  check(larguraLog > 500, `e o registro ocupa o espaço que sobrou (${larguraLog}px)`);
  check((await zeca.locator('#mao .carta').count()) === 0, 'nem uma carta na mão');

  const vazouMao = await zeca.evaluate(() => JSON.stringify(estadoAtual.jogadores).includes('"mao"'));
  check(!vazouMao, 'a mão de ninguém chega até o espectador');
  const vazouPrevia = await zeca.evaluate(() => Object.keys(estadoAtual.previsoes || {}).length);
  check(vazouPrevia === 0, 'nem a prévia das jogadas');

  check((await ana.textContent('#assistindo')).includes('1'), 'os jogadores veem 1 assistindo');
  await ana.screenshot({ path: path.join(raiz, 'shot-plateia.png') });
  await zeca.screenshot({ path: path.join(raiz, 'shot-espectador.png') });

  // espectador tentando forjar uma jogada pelo console
  const resposta = await zeca.evaluate(() => new Promise((r) => {
    const uid = (estadoAtual.fila[0] || {}).uid || 'x';
    socket.emit('jogar-carta', { uid }, r);
  }));
  check(!resposta.ok && /assistindo/i.test(resposta.erro || ''),
    `o servidor recusa jogada de espectador: "${resposta.erro}"`);

  const filaAntes = await ana.locator('#fila .carta').count();
  await espera(500);
  check((await ana.locator('#fila .carta').count()) === filaAntes, 'e a fila não mudou');

  check(erros.length === 0, `nenhum erro de JavaScript ${erros.length ? JSON.stringify(erros) : ''}`);
  await b.close(); s.kill(); process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('EXPLODIU:', e); s.kill(); process.exit(1); });
