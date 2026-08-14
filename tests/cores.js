// Regressao do bug das cores: um jogador que troca de cor entre uma partida e
// outra nao pode aparecer com a cor antiga. O bug acontecia porque o elemento da
// carta era reaproveitado pelo uid, e o uid nao mudava de uma partida pra outra.

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const raiz = path.join(__dirname, '..');
const PORTA = 3988, url = `http://localhost:${PORTA}`;
const s = spawn('node', ['server/index.js'], { cwd: raiz, env: { ...process.env, PORT: PORTA } });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let falhas = 0;
const check = (c, m) => { console.log(`${c ? 'ok   ' : 'FALHA'}  ${m}`); if (!c) falhas++; };

// A cor que a carta realmente mostra na tela. Com a arte nova, a cor do dono e
// o anel em volta da carta (o primeiro rgb que aparece no box-shadow).
const corDaCarta = (p, seletor) =>
  p.locator(seletor).first().evaluate((e) => {
    const sombra = getComputedStyle(e).boxShadow;
    const achou = sombra.match(/rgba?\([^)]+\)/);
    return achou ? achou[0] : sombra;
  });
const corDaFicha = (p, nome) =>
  p.locator(`#placar li:has-text("${nome}") .bolinha`).first()
    .evaluate((e) => getComputedStyle(e).backgroundColor);

(async () => {
  await espera(2500);
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctxA = await b.newContext({ viewport: { width: 1280, height: 860 } });
  const ctxB = await b.newContext({ viewport: { width: 1280, height: 860 } });
  const ana = await ctxA.newPage(), bruno = await ctxB.newPage();
  const erros = [];
  const doYoutube = (t) => /youtube|ytimg|iframe_api|ERR_TUNNEL/i.test(t);
  for (const [n, p] of [['Ana', ana], ['Bruno', bruno]]) {
    p.on('pageerror', (e) => !doYoutube(e.message) && erros.push(`${n}: ${e.message}`));
  }
  await ana.goto(url); await bruno.goto(url); await espera(600);

  // ---- PARTIDA 1: Ana cria, então Ana é vermelha e Bruno azul
  await ana.fill('#nome', 'Ana'); await ana.click('#btn-criar'); await espera(500);
  const cod1 = (await ana.textContent('#codigo-sala')).trim();
  await bruno.fill('#nome', 'Bruno'); await bruno.fill('#codigo', cod1);
  await bruno.click('#btn-entrar'); await espera(400);
  await ana.click('#btn-comecar'); await espera(900);

  const anaNa1 = await corDaCarta(ana, '#mao .carta');
  check(anaNa1 === 'rgb(224, 82, 99)', `na 1ª partida a mão da Ana é vermelha (${anaNa1})`);

  // joga uma carta para haver cartas na fila/ralo com esses elementos
  await ana.locator('#mao .carta.jogavel').first().click();
  await espera(400);
  let et = 0;
  while (await ana.locator('.faixa--decidindo').count() > 0 && et++ < 3) {
    await ana.locator('#fila .carta.alvo').first().click(); await espera(400);
  }
  await espera(2600);

  // ---- Ana sai pelo menu da partida
  await ana.click('#btn-menu'); await espera(250);
  check(await ana.locator('#menu-lista').isVisible(), 'o menu da partida abre');
  check(await ana.locator('#menu-instrucoes').isVisible(), 'com instruções');
  check(await ana.locator('#menu-sair').isVisible(), 'e com sair da partida');
  await ana.click('#menu-sair'); await espera(700);
  check(await ana.locator('#tela-entrada').isVisible(), 'quem sai volta ao menu principal');
  check(await bruno.locator('#tela-entrada').isVisible(), 'e a sala é encerrada para o outro também');

  // ---- PARTIDA 2: agora BRUNO cria, então as cores trocam
  await bruno.click('#btn-criar'); await espera(600);
  const cod2 = (await bruno.textContent('#codigo-sala')).trim();
  await ana.fill('#codigo', cod2); await ana.click('#btn-entrar'); await espera(500);
  await bruno.click('#btn-comecar'); await espera(1200);

  const anaNa2 = await corDaCarta(ana, '#mao .carta');
  const fichaDaAna = await corDaFicha(ana, 'Ana');
  check(anaNa2 === 'rgb(79, 157, 224)', `na 2ª partida a mão da Ana é azul (${anaNa2})`);
  check(anaNa2 === fichaDaAna, `a cor da carta bate com a do placar (${anaNa2} = ${fichaDaAna})`);
  check(anaNa2 !== anaNa1, 'a cor mudou de verdade entre as partidas — sem sobra da anterior');

  // o mesmo pela visão do Bruno, que agora é o vermelho
  const brunoNa2 = await corDaCarta(bruno, '#mao .carta');
  check(brunoNa2 === 'rgb(224, 82, 99)', `Bruno virou vermelho na 2ª partida (${brunoNa2})`);

  const mini = await bruno.evaluate(() => {
    const v = getComputedStyle(document.documentElement);
    return { l: parseInt(v.getPropertyValue('--mini-l')), a: parseInt(v.getPropertyValue('--mini-a')) };
  });
  check(mini.l >= 56 && mini.a >= 74, `cartas do bar e do ralo maiores (${mini.l}x${mini.a})`);

  check(erros.length === 0, `nenhum erro de JavaScript ${erros.length ? JSON.stringify(erros) : ''}`);
  await ana.screenshot({ path: path.join(raiz, 'shot-cores.png') });
  await b.close(); s.kill(); process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('EXPLODIU:', e); s.kill(); process.exit(1); });
