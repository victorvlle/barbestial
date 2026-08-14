// Confere que cada carta na tela usa a arte do animal certo e que as 12 imagens
// existem e carregam. E a checagem que amarra arte <-> id <-> forca.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const raiz = path.join(__dirname, '..');
const PORTA = 3984, url = `http://localhost:${PORTA}`;
const s = spawn('node', ['server/index.js'], { cwd: raiz, env: { ...process.env, PORT: PORTA } });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let falhas = 0;
const check = (c, m) => { console.log(`${c ? 'ok   ' : 'FALHA'}  ${m}`); if (!c) falhas++; };

(async () => {
  await espera(2500);
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ana = await (await b.newContext({ viewport: { width: 1366, height: 800 } })).newPage();
  const bruno = await (await b.newContext({ viewport: { width: 1366, height: 800 } })).newPage();
  const erros = [];
  const doYoutube = (t) => /youtube|ytimg|iframe_api|ERR_TUNNEL/i.test(t);
  ana.on('pageerror', (e) => !doYoutube(e.message) && erros.push(e.message));
  ana.on('requestfailed', (r) => !doYoutube(r.url()) && erros.push('falhou: ' + r.url()));

  await ana.goto(url); await bruno.goto(url); await espera(600);

  // as 12 artes existem e são as 12 do catálogo
  const catalogo = await ana.evaluate(async () => {
    const r = await fetch('/api/animais');
    return (await r.json()).animais.map((a) => ({ id: a.id, nome: a.nome, forca: a.forca }));
  });
  check(catalogo.length === 12, `o catálogo tem 12 animais`);

  const faltando = [];
  for (const a of catalogo) {
    const ok = await ana.evaluate((id) => new Promise((r) => {
      const img = new Image();
      img.onload = () => r({ ok: true, l: img.naturalWidth, a: img.naturalHeight });
      img.onerror = () => r({ ok: false });
      img.src = `/assets/cartas/${id}.webp`;
    }), a.id);
    if (!ok.ok) faltando.push(a.id);
  }
  check(faltando.length === 0, `as 12 artes carregam ${faltando.length ? '— faltam: ' + faltando : ''}`);

  const antiga = await ana.evaluate(() => fetch('/assets/animais.svg').then((r) => r.status));
  check(antiga === 404, `a arte antiga (animais.svg) não é mais servida (HTTP ${antiga})`);

  // dentro do jogo: cada carta aponta para a arte do seu próprio animal
  await ana.fill('#nome', 'Ana'); await ana.click('#btn-criar'); await espera(500);
  const cod = (await ana.textContent('#codigo-sala')).trim();
  await bruno.fill('#nome', 'Bruno'); await bruno.fill('#codigo', cod);
  await bruno.click('#btn-entrar'); await espera(400);
  await ana.click('#btn-comecar'); await espera(900);

  const mao = await ana.evaluate(() => {
    const eu = estadoAtual.jogadores.find((j) => j.id === estadoAtual.souEu);
    return eu.mao.map((c) => c.animal);
  });
  const artes = await ana.locator('#mao .carta .arte').evaluateAll((els) =>
    els.map((e) => e.getAttribute('src').split('/').pop().replace('.webp', ''))
  );
  check(JSON.stringify(mao) === JSON.stringify(artes),
    `cada carta da mão usa a arte do seu animal (${artes.join(', ')})`);

  const semNumeroDuplicado = await ana.locator('#mao .carta').evaluateAll((els) =>
    els.every((e) => !e.querySelector('.forca') && !e.querySelector('.nome'))
  );
  check(semNumeroDuplicado, 'o código não desenha número nem nome por cima da arte');

  const proporcao = await ana.locator('#mao .carta').first().evaluate((e) => {
    const r = e.getBoundingClientRect();
    const img = e.querySelector('.arte');
    return { carta: r.width / r.height, arte: img.naturalWidth / img.naturalHeight };
  });
  check(Math.abs(proporcao.carta - proporcao.arte) < 0.02,
    `a carta tem a proporção da arte, sem esticar (${proporcao.carta.toFixed(3)} x ${proporcao.arte.toFixed(3)})`);

  check(erros.length === 0, `nenhum erro ou recurso quebrado ${erros.length ? JSON.stringify(erros.slice(0, 3)) : ''}`);
  await ana.screenshot({ path: path.join(raiz, 'shot-artes.png') });
  await b.close(); s.kill(); process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('EXPLODIU:', e); s.kill(); process.exit(1); });
