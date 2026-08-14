// Testa a camada de hologramas no navegador de verdade.
// Rode com: node tests/hologramas.js
//
// O que precisa ficar provado aqui:
//   1. o servidor manda os efeitos junto com a jogada
//   2. o animal que aparece e o animal certo
//   3. a animacao acontece ANTES do quadro que mostra o resultado
//   4. o holograma some sozinho e nao deixa lixo na tela
//   5. a fila continua obedecendo o servidor - nenhuma regra mudou
//   6. se uma animacao der erro, o jogo segue
//   7. o palco nao rouba clique nenhum
//   8. desligando os hologramas, nao aparece nada

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const raiz = path.join(__dirname, '..');
const PORTA = 3987;
const url = `http://localhost:${PORTA}`;
const servidor = spawn('node', ['server/index.js'], { cwd: raiz, env: { ...process.env, PORT: PORTA } });

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let falhas = 0;
const check = (c, m) => { console.log(`${c ? 'ok   ' : 'FALHA'}  ${m}`); if (!c) falhas++; };

// Os 12 animais + as cenas que nao sao "um animal jogado": o impasse do cavalo,
// o duelo de lobos, a volta do polvo e as duas caras do babuíno.
const CENAS = [
  { tipo: 'porcoespinho', animal: 'porcoespinho', alvos: 2 },
  { tipo: 'tucano', animal: 'tucano', alvos: 1 },
  { tipo: 'coelho', animal: 'coelho', alvos: 2, extra: { pulos: 2 } },
  { tipo: 'babuino-solo', animal: 'babuino', alvos: 0 },
  { tipo: 'babuino-bando', animal: 'babuino', alvos: 1, bando: 2 },
  { tipo: 'polvo', animal: 'polvo', alvos: 0, extra: { copiando: 'tucano' }, deixaEmCena: true },
  { tipo: 'polvo-volta', animal: 'polvo', alvos: 0, extra: { copiando: 'tucano' }, depoisDe: 'polvo' },
  { tipo: 'pinguim', animal: 'pinguim', alvos: 3 },
  { tipo: 'cavalo', animal: 'cavalo', alvos: 0 },
  { tipo: 'bloqueio', animal: 'cavalo', alvos: 1, alvoAnimais: ['tubarao'] },
  { tipo: 'pavao', animal: 'pavao', alvos: 1 },
  { tipo: 'aguia', animal: 'aguia', alvos: 3 },
  { tipo: 'tubarao', animal: 'tubarao', alvos: 2 },
  { tipo: 'elefante', animal: 'elefante', alvos: 2, extra: { passou: 2 } },
  { tipo: 'lobo', animal: 'lobo', alvos: 1 },
  { tipo: 'lobo-duelo', animal: 'lobo', alvos: 1, alvoAnimais: ['lobo'] },
];

(async () => {
  await espera(2500);
  const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const contexto = await navegador.newContext({ viewport: { width: 1366, height: 800 } });
  const ana = await contexto.newPage();
  const bruno = await (await navegador.newContext({ viewport: { width: 1366, height: 800 } })).newPage();

  const erros = [];
  const doYoutube = (t) => /youtube|ytimg|iframe_api|ERR_TUNNEL/i.test(t);
  ana.on('pageerror', (e) => !doYoutube(e.message) && erros.push(e.message));
  ana.on('requestfailed', (r) => !doYoutube(r.url()) && erros.push('falhou: ' + r.url()));

  await ana.goto(url);
  await bruno.goto(url);
  await espera(600);

  // ------------------------------------------------------ os 12 recortes existem
  const catalogo = await ana.evaluate(async () =>
    (await (await fetch('/api/animais')).json()).animais.map((a) => a.id)
  );
  const semRecorte = [];
  for (const id of catalogo) {
    const ok = await ana.evaluate(
      (i) => new Promise((r) => {
        const img = new Image();
        img.onload = () => r(img.naturalWidth > 0);
        img.onerror = () => r(false);
        img.src = `/assets/holo/${i}.webp`;
      }),
      id
    );
    if (!ok) semRecorte.push(id);
  }
  check(semRecorte.length === 0, `os 12 recortes de holograma carregam ${semRecorte.length ? '— faltam: ' + semRecorte : ''}`);

  // ------------------------------------------------------ o palco existe e nao clica
  const palco = await ana.evaluate(() => {
    const el = document.getElementById('palco');
    if (!el) return null;
    const s = getComputedStyle(el);
    return { existe: true, cliques: s.pointerEvents, z: s.zIndex };
  });
  check(palco && palco.existe, 'a camada #palco existe na página');
  check(palco && palco.cliques === 'none', `o palco não recebe clique (pointer-events: ${palco?.cliques})`);

  // ------------------------------------------------------ começa uma partida
  await ana.fill('#nome', 'Ana');
  await ana.click('#btn-criar');
  await espera(500);
  const codigo = (await ana.textContent('#codigo-sala')).trim();
  await bruno.fill('#nome', 'Bruno');
  await bruno.fill('#codigo', codigo);
  await bruno.click('#btn-entrar');
  await espera(400);
  await ana.click('#btn-comecar');
  await espera(1000);

  // ------------------------------------------------------ cada cena, uma por uma
  //
  // Em vez de torcer para o baralho dar as 12 cartas certas, montamos o efeito
  // a mao - exatamente no formato que o servidor manda - e mandamos o maestro
  // encenar. E o mesmo caminho que o jogo usa de verdade.
  for (const cena of CENAS) {
    const resultado = await ana.evaluate(async (c) => {
      const cartas = [...document.querySelectorAll('.carta[data-uid]')].map((e) => e.dataset.uid);
      if (cartas.length < 2) return { erro: 'sem cartas na tela' };

      const efeito = {
        tipo: c.tipo,
        autor: cartas[0],
        animal: c.animal,
        dono: estadoAtual.souEu,
        alvos: cartas.slice(1, 1 + c.alvos),
        alvoAnimais: c.alvoAnimais || [],
        quadro: 0,
        ...(c.extra || {}),
      };
      if (c.bando) efeito.bando = cartas.slice(0, c.bando);

      const cores = Object.fromEntries(estadoAtual.jogadores.map((j) => [j.id, j.cor]));
      const rodando = reproduzirEfeitos([efeito], cores);

      // No meio da animação: quem apareceu no palco?
      await new Promise((r) => setTimeout(r, 320));
      const noPalco = [...document.querySelectorAll('#palco .holo .holo-arte')].map((i) =>
        i.getAttribute('src').split('/').pop().replace('.webp', '')
      );
      const efeitosSoltos = document.querySelectorAll('#palco .efeito').length;

      await rodando;
      await new Promise((r) => setTimeout(r, 120));
      const sobrou = document.querySelectorAll('#palco .holo').length;
      return { noPalco, efeitosSoltos, sobrou };
    }, cena);

    if (resultado.erro) { check(false, `${cena.tipo}: ${resultado.erro}`); continue; }

    // 1. o animal certo apareceu
    check(
      resultado.noPalco.includes(cena.animal),
      `${cena.tipo}: aparece o ${cena.animal} (viu: ${resultado.noPalco.join(', ') || 'nada'})`
    );

    // 2. o holograma some quando acaba - menos o polvo, que fica de propósito
    //    esperando o "polvo-volta" (é a mesma criatura, transformada).
    if (cena.deixaEmCena) {
      check(resultado.sobrou === 1, `${cena.tipo}: o polvo transformado continua em cena para a volta`);
    } else {
      check(resultado.sobrou === 0, `${cena.tipo}: o palco fica limpo no fim (${resultado.sobrou} sobrando)`);
    }
  }

  // ------------------------------------------------------ o polvo troca de pele
  const troca = await ana.evaluate(async () => {
    limparPalco();
    const cartas = [...document.querySelectorAll('.carta[data-uid]')].map((e) => e.dataset.uid);
    const cores = Object.fromEntries(estadoAtual.jogadores.map((j) => [j.id, j.cor]));
    const base = { autor: cartas[0], animal: 'polvo', dono: estadoAtual.souEu, alvos: [], quadro: 0, copiando: 'aguia' };

    const rodando = reproduzirEfeitos([{ ...base, tipo: 'polvo' }], cores);
    await new Promise((r) => setTimeout(r, 200));
    const antes = document.querySelector('#palco .holo-arte')?.getAttribute('src') || '';
    await rodando;
    const depois = document.querySelector('#palco .holo-arte')?.getAttribute('src') || '';

    await reproduzirEfeitos([{ ...base, tipo: 'polvo-volta' }], cores);
    const fim = document.querySelectorAll('#palco .holo').length;
    return { antes, depois, fim };
  });
  check(troca.antes.includes('polvo'), 'polvo: começa como polvo');
  check(troca.depois.includes('aguia'), `polvo: vira o animal copiado (${troca.depois.split('/').pop()})`);
  check(troca.fim === 0, 'polvo: volta a ser polvo e sai de cena');

  // ------------------------------------------------------ a ordem: holograma, depois quadro
  const ordem = await ana.evaluate(async () => {
    const registro = [];
    const pintarOriginal = window.pintarTabuleiro;
    const efeitosOriginal = window.reproduzirEfeitos;
    // Substituímos as duas por espiãs, só para anotar quem foi chamado quando.
    window.pintarTabuleiro = (...a) => { registro.push('quadro'); return pintarOriginal(...a); };
    window.reproduzirEfeitos = async () => { registro.push('holo'); };

    const falso = {
      jogadores: estadoAtual.jogadores,
      souEu: estadoAtual.souEu,
      fila: estadoAtual.fila,
      bar: estadoAtual.bar,
      ralo: estadoAtual.ralo,
      quadros: [
        { fila: [], bar: [], ralo: [] },
        { fila: [], bar: [], ralo: [] },
      ],
      efeitos: [
        { tipo: 'lobo', autor: null, animal: 'lobo', dono: estadoAtual.souEu, alvos: [], quadro: 0 },
        { tipo: 'aguia', autor: null, animal: 'aguia', dono: estadoAtual.souEu, alvos: [], quadro: 1 },
      ],
    };
    await reproduzirJogada(falso);
    window.pintarTabuleiro = pintarOriginal;
    window.reproduzirEfeitos = efeitosOriginal;
    atualizar(); // desfaz o tabuleiro de mentira e redesenha o estado real
    return registro;
  });
  // O primeiro "quadro" é o atualizar() que trava os cliques no começo da
  // reprodução; o que interessa vem depois dele.
  check(
    JSON.stringify(ordem.slice(1)) === JSON.stringify(['holo', 'quadro', 'holo']),
    `a animação vem antes do quadro que mostra o resultado (${ordem.join(' → ')})`
  );

  // ------------------------------------------------------ agrupamento por quadro
  const agrupou = await ana.evaluate(() => {
    const m = efeitosPorQuadro(
      [{ quadro: 0 }, { quadro: 2 }, { quadro: 2 }, { quadro: 9 }],
      3
    );
    return { q0: m.get(0)?.length || 0, q2: m.get(2)?.length || 0, total: [...m.values()].flat().length };
  });
  check(agrupou.q0 === 1 && agrupou.q2 === 3, 'efeito de quadro inexistente cai no último, nenhum se perde');
  check(agrupou.total === 4, 'todos os efeitos são distribuídos');

  // ------------------------------------------------------ animação com erro nao derruba o jogo
  const sobreviveu = await ana.evaluate(async () => {
    limparPalco();
    const original = ANIMACOES.lobo;
    ANIMACOES.lobo = async () => { throw new Error('erro de propósito no teste'); };
    const cores = Object.fromEntries(estadoAtual.jogadores.map((j) => [j.id, j.cor]));
    let explodiu = false;
    try {
      await reproduzirEfeitos(
        [
          { tipo: 'lobo', autor: null, animal: 'lobo', dono: estadoAtual.souEu, alvos: [], quadro: 0 },
          { tipo: 'aguia', autor: null, animal: 'aguia', dono: estadoAtual.souEu, alvos: [], quadro: 0 },
        ],
        cores
      );
    } catch (e) {
      explodiu = true;
    }
    ANIMACOES.lobo = original;
    limparPalco();
    return { explodiu, cartasNaTela: document.querySelectorAll('.carta').length };
  });
  check(!sobreviveu.explodiu, 'uma animação que dá erro não derruba a jogada');
  check(sobreviveu.cartasNaTela > 0, 'as cartas continuam na tela depois do erro');

  // ------------------------------------------------------ limparPalco tira tudo
  const limpou = await ana.evaluate(async () => {
    const cores = Object.fromEntries(estadoAtual.jogadores.map((j) => [j.id, j.cor]));
    reproduzirEfeitos([{ tipo: 'pinguim', autor: null, animal: 'pinguim', dono: estadoAtual.souEu, alvos: [], quadro: 0 }], cores);
    await new Promise((r) => setTimeout(r, 200));
    const durante = document.querySelectorAll('#palco > *').length;
    limparPalco();
    return { durante, depois: document.querySelectorAll('#palco > *').length };
  });
  check(limpou.durante > 0 && limpou.depois === 0, 'limparPalco esvazia o palco na hora');

  // ------------------------------------------------------ uma jogada de verdade
  // Quem joga é quem está na vez - o baralho é sorteado, então descobrimos na hora.
  const daVez = (await ana.evaluate(() => estadoAtual.vezDe === estadoAtual.souEu)) ? ana : bruno;

  const antesDaJogada = await daVez.evaluate(() => ({
    fila: estadoAtual.fila.map((c) => c.uid),
    jogadas: estadoAtual.jogadas,
  }));

  // Uma espiã no palco: anota tudo que aparecer durante a jogada. Sem isso o
  // teste poderia passar com a animação nunca chegando à tela de verdade.
  await daVez.evaluate(() => {
    limparPalco();
    window.VISTOS = [];
    new MutationObserver(() => {
      for (const img of document.querySelectorAll('#palco .holo-arte')) {
        const n = img.getAttribute('src').split('/').pop().replace('.webp', '');
        if (!window.VISTOS.includes(n)) window.VISTOS.push(n);
      }
    }).observe(document.getElementById('palco'), { childList: true, subtree: true });
  });

  await daVez.locator('#mao .carta').first().click();
  await espera(400);
  // Algumas cartas pedem decisão: se a faixa de escolha apareceu, escolhe a primeira.
  if (await daVez.locator('#fila .carta.alvo').count()) {
    await daVez.locator('#fila .carta.alvo').first().click();
  }
  await espera(1200);

  const durante = await daVez.evaluate(() => ({
    temEfeitos: Array.isArray(estadoAtual.efeitos),
    quantos: (estadoAtual.efeitos || []).length,
  }));
  check(durante.temEfeitos, 'o servidor manda a lista de efeitos junto com o estado');

  await espera(5200); // deixa a jogada inteira terminar

  const depois = await daVez.evaluate(() => ({
    vistos: window.VISTOS || [],
    palcoVazio: document.querySelectorAll('#palco > *').length === 0,
    // A fila desenhada tem que ser exatamente a fila que o servidor mandou.
    filaNaTela: [...document.querySelectorAll('#fila .carta')].map((e) => e.dataset.uid),
    filaNoServidor: estadoAtual.fila.map((c) => c.uid),
    jogadas: estadoAtual.jogadas,
    // 'carta--mini' é do layout, não da animação: não entra na conta.
    reacoesPresas: document.querySelectorAll(REACOES.map((c) => `.${c}`).join(',')).length,
    // e as cartas pequenas do bar e do ralo continuam pequenas
    minisIntactas: document.querySelectorAll('#bar .carta--mini, #ralo .carta--mini').length ===
      document.querySelectorAll('#bar .carta, #ralo .carta').length,
  }));

  check(depois.jogadas > antesDaJogada.jogadas, 'a jogada aconteceu de verdade');
  // A carta jogada pode não ter poder nenhum naquele momento (um cavalo sozinho,
  // um porco-espinho sem alvo): aí não há nada para animar, e tudo bem.
  console.log(
    `        (hologramas que apareceram nessa jogada: ${depois.vistos.join(', ') || 'nenhum — a carta jogada não teve efeito'})`
  );
  check(depois.palcoVazio, 'terminada a jogada, o palco fica vazio');
  check(depois.reacoesPresas === 0, 'nenhuma carta fica presa numa classe de reação');
  check(depois.minisIntactas, 'a limpeza não mexe no tamanho das cartas do bar e do ralo');
  check(
    JSON.stringify(depois.filaNaTela) === JSON.stringify(depois.filaNoServidor),
    'a fila na tela é exatamente a fila do servidor — nenhuma regra mudou'
  );

  // ------------------------------------------------------ desligado, nao aparece nada
  const desligado = await ana.evaluate(async () => {
    limparPalco();
    preferencias.definirHolo(false);
    const cores = Object.fromEntries(estadoAtual.jogadores.map((j) => [j.id, j.cor]));
    await reproduzirEfeitos([{ tipo: 'lobo', autor: null, animal: 'lobo', dono: estadoAtual.souEu, alvos: [], quadro: 0 }], cores);
    const nada = document.querySelectorAll('#palco > *').length;
    preferencias.definirHolo(true);
    return nada;
  });
  check(desligado === 0, 'com os hologramas desligados, nada é desenhado');

  // ------------------------------------------------------ o clique atravessa o palco
  const cliqueChegou = await ana.evaluate(() => {
    const carta = document.querySelector('#mao .carta');
    if (!carta) return false;
    const r = carta.getBoundingClientRect();
    const emCima = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return Boolean(emCima && emCima.closest('.carta') === carta);
  });
  check(cliqueChegou, 'o clique numa carta atravessa o palco e chega na carta');

  check(erros.length === 0, `nenhum erro de página ou recurso quebrado ${erros.length ? JSON.stringify(erros.slice(0, 3)) : ''}`);

  await ana.screenshot({ path: path.join(raiz, 'shot-hologramas.png') });
  await navegador.close();
  servidor.kill();
  process.exit(falhas ? 1 : 0);
})().catch((e) => {
  console.error('EXPLODIU:', e);
  servidor.kill();
  process.exit(1);
});
