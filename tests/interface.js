// Reproduz a janela baixa do usuario e confere que a previa nao cobre o "i".
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const raiz = path.join(__dirname, '..');
const PORTA = 3983, url = `http://localhost:${PORTA}`;
const s = spawn('node', ['server/index.js'], { cwd: raiz, env: { ...process.env, PORT: PORTA } });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let falhas = 0;
const check = (c, m) => { console.log(`${c ? 'ok   ' : 'FALHA'}  ${m}`); if (!c) falhas++; };

(async () => {
  await espera(2500);
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  // janela baixa de proposito: e onde a previa encostava na mao
  const ctx = { viewport: { width: 1280, height: 620 } };
  const ana = await (await b.newContext(ctx)).newPage();
  const bruno = await (await b.newContext(ctx)).newPage();
  await ana.goto(url); await bruno.goto(url); await espera(600);
  await ana.fill('#nome','Ana'); await ana.click('#btn-criar'); await espera(500);
  const cod = (await ana.textContent('#codigo-sala')).trim();
  await bruno.fill('#nome','Bruno'); await bruno.fill('#codigo',cod); await bruno.click('#btn-entrar'); await espera(400);
  await ana.click('#btn-comecar'); await espera(900);

  // enche um pouco a fila
  const daVez = async () => ((await ana.locator('.faixa--minha-vez').count()) > 0 ? ana : bruno);
  for (let i = 0; i < 3; i++) {
    const p = await daVez();
    await p.locator('#mao .carta.jogavel').first().waitFor({ timeout: 8000 });
    await p.locator('#mao .carta.jogavel').first().click(); await espera(350);
    let e = 0;
    while (await p.locator('.faixa--decidindo').count() > 0 && e++ < 3) {
      await p.locator('#fila .carta.alvo').first().click(); await espera(350);
    }
    await espera(2700);
  }

  const p = await daVez();
  await p.locator('#mao .carta.jogavel').first().waitFor({ timeout: 8000 });
  const carta = p.locator('#mao .carta').nth(1);
  await carta.hover();
  await espera(500);
  check(await p.locator('#previa').evaluate((e) => e.classList.contains('previa--ativa')), 'a prévia aparece ao passar na carta');

  // A prévia mora no alto da mesa. Embaixo da fila ela era engolida pelos
  // blocos do rodapé numa janela baixa como esta - foi o que motivou a mudança.
  const lugar = await p.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const pv = r('#previa');
    const cruza = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    return {
      acimaDaMesa: Math.round(pv.bottom) <= Math.round(r('.mesa').top) + 2,
      encostaNoRodape: cruza(pv, r('.rodape')),
      cobreCartaDaFila: [...document.querySelectorAll('#fila .carta')].some((c) => cruza(pv, c.getBoundingClientRect())),
      dentroDaTela: pv.top >= 0 && pv.bottom <= innerHeight,
    };
  });
  check(lugar.acimaDaMesa, 'a prévia fica acima da mesa, não embaixo da fila');
  check(!lugar.encostaNoRodape, 'a prévia não encosta nos blocos do rodapé');
  check(!lugar.cobreCartaDaFila, 'a prévia não cobre nenhuma carta da fila');
  check(lugar.dentroDaTela, 'a prévia cabe inteira na tela');

  // O nome do animal vem impresso na arte: se a carta da prévia ficar menor que
  // a do bar e do ralo, o nome some e a prévia perde a serventia.
  const tamanho = await p.evaluate(() => {
    const c = document.querySelector('#previa-linha .carta');
    return c ? Math.round(c.getBoundingClientRect().height) : 0;
  });
  check(tamanho >= 80, `as cartas da prévia são grandes o bastante para ler o nome (${tamanho}px de altura)`);

  // Ritmo: nenhuma pausa pode ser menor que o deslize, senão o quadro seguinte
  // é pintado no meio do movimento e a reorganização da fila vira um piscar.
  const ritmo = await p.evaluate(() => ({ DURACAO, PAUSA_ENTRE_QUADROS, PAUSA_CURTA }));
  check(ritmo.PAUSA_CURTA >= ritmo.DURACAO,
    `a pausa depois de um holograma cobre o deslize inteiro (${ritmo.PAUSA_CURTA} ≥ ${ritmo.DURACAO}ms)`);
  check(ritmo.PAUSA_ENTRE_QUADROS >= ritmo.DURACAO,
    `a pausa entre quadros cobre o deslize inteiro (${ritmo.PAUSA_ENTRE_QUADROS} ≥ ${ritmo.DURACAO}ms)`);

  // o "i" daquela carta esta realmente clicavel (ninguem por cima)?
  const alvoDoClique = await carta.locator('.info').evaluate((el) => {
    const r = el.getBoundingClientRect();
    const emCima = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { classe: emCima?.className || '', tag: emCima?.tagName };
  });
  check(String(alvoDoClique.classe).includes('info'),
    `quem está no ponto do "i" é o próprio botão (${alvoDoClique.tag}.${alvoDoClique.classe})`);

  await carta.locator('.info').click();
  await espera(400);
  check(await p.locator('#balao').isVisible(), 'e o clique abre a explicação');
  check(!(await p.locator('#previa').evaluate((e) => e.classList.contains('previa--ativa'))), 'a prévia sai da frente ao mirar o "i"');
  check((await p.locator('#mao .carta').count()) === 4, 'e a carta não foi jogada por engano');

  // o anel da cor do dono ficou visivel?
  const anel = await p.locator('#mao .carta').first().evaluate((e) => getComputedStyle(e).boxShadow);
  const grossura = anel.match(/rgba?\([^)]+\)\s+0px\s+0px\s+0px\s+(\d+)px/);
  check(grossura && Number(grossura[1]) >= 4, `o anel da cor do dono tem ${grossura ? grossura[1] : '?'}px`);

  await p.screenshot({ path: path.join(raiz, 'shot-i.png') });
  await b.close(); s.kill(); process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('EXPLODIU:', e); s.kill(); process.exit(1); });
