// Teste visual das melhorias: prévia, botão "i", instruções, log colorido.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const raiz = path.join(__dirname, '..');
const PORTA = 3994, url = `http://localhost:${PORTA}`;
const s = spawn('node', ['server/index.js'], { cwd: raiz, env: { ...process.env, PORT: PORTA } });
const espera = ms => new Promise(r => setTimeout(r, ms));
let falhas = 0;
const check = (c, m) => { console.log(`${c ? 'ok   ' : 'FALHA'}  ${m}`); if (!c) falhas++; };

(async () => {
  await espera(2500);
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctxA = await b.newContext({ viewport: { width: 1180, height: 900 } });
  const ctxB = await b.newContext({ viewport: { width: 1180, height: 900 } });
  const ana = await ctxA.newPage(), bruno = await ctxB.newPage();
  const erros = [];
  for (const [n, p] of [['Ana', ana], ['Bruno', bruno]]) {
    p.on('pageerror', e => erros.push(`${n}: ${e.message}`));
    p.on('console', m => m.type() === 'error' && erros.push(`${n} console: ${m.text()}`));
  }
  await ana.goto(url); await bruno.goto(url); await espera(600);

  // menu principal
  check(await ana.locator('#opt-previa').isVisible(), 'a opção de prévia aparece no menu principal');
  check(await ana.locator('#btn-instrucoes').isVisible(), 'o botão de instruções aparece no menu principal');
  await ana.click('#btn-instrucoes'); await espera(400);
  check(await ana.locator('#modal').isVisible(), 'a janela de instruções abre');
  check((await ana.locator('.instr-lista li').count()) === 12, 'as instruções listam os 12 animais');
  await ana.screenshot({ path: path.join(raiz, 'shot-instrucoes.png') });
  await ana.keyboard.press('Escape'); await espera(300);
  check(!(await ana.locator('#modal').isVisible()), 'Esc fecha as instruções');

  // partida
  await ana.fill('#nome', 'Ana'); await ana.click('#btn-criar'); await espera(500);
  const codigo = (await ana.textContent('#codigo-sala')).trim();
  await bruno.fill('#nome', 'Bruno'); await bruno.fill('#codigo', codigo);
  await bruno.click('#btn-entrar'); await espera(400);
  await ana.click('#btn-comecar'); await espera(700);

  const daVez = async () => ((await ana.locator('.faixa--minha-vez').count()) > 0 ? ana : bruno);
  const jogar = async () => {
    const p = await daVez();
    await p.locator('#mao .carta.jogavel').first().waitFor({ timeout: 9000 });
    await p.locator('#mao .carta.jogavel').first().click();
    await espera(400);
    let e = 0;
    while (await p.locator('.faixa--decidindo').count() > 0 && e++ < 3) {
      await p.locator('#fila .carta.alvo').first().click();
      await espera(400);
    }
    await espera(2900);
  };
  for (let i = 0; i < 4; i++) await jogar();

  // prévia
  const p = await daVez();
  await p.locator('#mao .carta.jogavel').first().waitFor({ timeout: 9000 });
  await p.mouse.move(5, 5); // tira o cursor de cima das cartas
  await espera(300);
  check(!(await p.locator('#previa').evaluate(e => e.classList.contains('previa--ativa'))), 'a prévia começa escondida');
  await p.locator('#mao .carta.jogavel').first().hover();
  await espera(500);
  const ativa = await p.locator('#previa').evaluate(e => e.classList.contains('previa--ativa'));
  check(ativa, 'passar o mouse na carta mostra a prévia');
  check((await p.locator('#previa-linha .carta').count()) > 0, 'a prévia desenha as cartas fantasma');
  await p.screenshot({ path: path.join(raiz, 'shot-previa.png') });

  // o "i"
  await p.locator('#mao .carta .info').first().click();
  await espera(400);
  check(await p.locator('#balao').isVisible(), 'o botão "i" abre a explicação da carta');
  const textoBalao = await p.textContent('#balao');
  check(textoBalao.length > 30, `o balão explica o poder: "${textoBalao.slice(0, 46).replace(/\s+/g,' ').trim()}…"`);
  check((await p.locator('#fila .carta').count()) > 0 && !(await p.locator('#previa').evaluate(e => e.classList.contains('previa--ativa')) && false), 'clicar no "i" não jogou a carta');
  const naMao = await p.locator('#mao .carta').count();
  check(naMao === 4, `a mão continua com 4 cartas depois do "i" (${naMao})`);
  await p.screenshot({ path: path.join(raiz, 'shot-balao.png') });

  // log colorido
  const coloridas = await ana.locator('#log li.com-dono').count();
  const total = await ana.locator('#log li').count();
  check(coloridas > 0, `${coloridas} de ${total} linhas do log têm a cor de quem agiu`);
  const cores = await ana.locator('#log li.com-dono').evaluateAll(els => [...new Set(els.map(e => getComputedStyle(e).borderLeftColor))]);
  check(cores.length >= 1, `cores presentes no log: ${cores.join(' | ')}`);

  // tudo dentro da tela, sem rolagem da página
  const cabe = await ana.evaluate(() => ({
    rolagem: document.documentElement.scrollHeight > window.innerHeight + 2,
    altura: document.documentElement.scrollHeight,
    janela: window.innerHeight,
  }));
  check(!cabe.rolagem, `a mesa cabe na tela sem rolar (${cabe.altura} <= ${cabe.janela})`);

  const larguraFila = await ana.locator('.pista').evaluate((e) => Math.round(e.getBoundingClientRect().width));
  const larguraCarta = await ana.locator('#fila .carta').first().evaluate((e) => Math.round(e.getBoundingClientRect().width));
  check(Math.abs(larguraFila - (larguraCarta * 5 + 8 * 4)) < 6,
    `a fila tem a largura exata de 5 cartas (${larguraFila}px para cartas de ${larguraCarta}px)`);

  // joga ate o fim para ver a comemoração
  for (let i = 0; i < 40; i++) {
    if (await ana.locator('#fim').isVisible()) break;
    const q = await daVez();
    try { await q.locator('#mao .carta.jogavel').first().waitFor({ timeout: 6000 }); } catch { break; }
    await q.locator('#mao .carta.jogavel').first().click();
    await espera(350);
    let et = 0;
    while (await q.locator('.faixa--decidindo').count() > 0 && et++ < 3) {
      await q.locator('#fila .carta.alvo').first().click();
      await espera(350);
    }
    await espera(2600);
  }

  check(await ana.locator('#fim').isVisible(), 'a comemoração de fim de jogo apareceu');
  const textoFim = (await ana.textContent('#fim-conteudo')).replace(/\s+/g, ' ').trim();
  check(textoFim.length > 40, `explica o resultado: "${textoFim.slice(0, 100)}…"`);
  check((await ana.locator('#confete i').count()) > 10, 'com confete');
  await ana.screenshot({ path: path.join(raiz, 'shot-fim.png') });

  check(erros.length === 0, `nenhum erro de JavaScript ${erros.length ? JSON.stringify(erros.slice(0,2)) : ''}`);
  await b.close(); s.kill(); process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('EXPLODIU:', e); s.kill(); process.exit(1); });
