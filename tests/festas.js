// O SISTEMA DE MÚSICA, num navegador de verdade.
// Rode com: node tests/festas.js
//
// As músicas de verdade são gravações comerciais e NÃO ficam no repositório.
// Para poder testar o sistema inteiro assim mesmo, esta suíte gera faixas
// próprias com o ffmpeg (tons curtos) numa pasta descartável e aponta o
// servidor para lá com FESTAS_PASTA. Não é substituição de música nenhuma: é
// sinal de teste, do mesmo jeito que um teste de e-mail usa um endereço falso.
//
// O que é conferido aqui é o que o pedido exige de verdade:
//   * o YouTube sumiu do projeto
//   * o seletor de festa aparece no menu e escolhe
//   * a festa toca de fato (o <audio> anda)
//   * a ordem é sorteada, sem repetir a mesma música na sequência
//   * todas tocam antes de qualquer repetição
//   * partida nova = ordem nova
//   * os controles do tocador funcionam

const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ambienteDeTeste, entrarNoJogo } = require('./ajuda');

const raiz = path.join(__dirname, '..');
const PORTA = 3966;
const url = `http://localhost:${PORTA}`;

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let falhas = 0;
const check = (c, m) => { console.log(`${c ? 'ok   ' : 'FALHA'}  ${m}`); if (!c) falhas++; };

// ------------------------------------------------- faixas de teste (nossas)
const pastaDeTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-festas-'));
const { FESTAS } = require('../server/game/festas');

// Cinco faixas por festa, com nome no formato de verdade ("Título - Artista").
const QUANTAS = 5;
const nomeDaFaixa = (festaId, i) => `Faixa ${i + 1} do teste - Artista ${festaId}.mp3`;

function gerarFaixas() {
  for (const festa of FESTAS) {
    const pasta = path.join(pastaDeTeste, festa.id);
    fs.mkdirSync(pasta, { recursive: true });
    for (let i = 0; i < QUANTAS; i++) {
      // Um tom curto e diferente por faixa: dá para saber qual está tocando.
      execFileSync('ffmpeg', [
        '-v', 'error', '-y',
        '-f', 'lavfi', '-i', `sine=frequency=${180 + i * 60}:duration=2`,
        '-ac', '1', '-b:a', '64k',
        path.join(pasta, nomeDaFaixa(festa.id, i)),
      ]);
    }
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

(async () => {
  gerarFaixas();
  await espera(2500);

  // ============================================== 1. o YouTube saiu do projeto
  const paginaCrua = await fetch(url).then((r) => r.text());
  const arquivos = ['/js/musica.js', '/js/main.js', '/css/style.css'];
  const fontes = await Promise.all(arquivos.map((a) => fetch(url + a).then((r) => r.text())));
  const tudo = paginaCrua + fontes.join('\n');

  check(!/youtube|ytimg|YT\.Player|iframe_api/i.test(tudo), 'nenhum vestígio do YouTube no jogo');
  check(!/<iframe/i.test(paginaCrua), 'e nenhum iframe na página');

  // ============================================== 2. a rota das festas
  const catalogo = await fetch(`${url}/api/festas`).then((r) => r.json());
  check(catalogo.ok && catalogo.festas.length === 2, 'o servidor lista as duas festas');
  const edm = catalogo.festas.find((f) => f.id === 'edm');
  check(edm && edm.total === QUANTAS, `a playlist sai da PASTA, não de uma lista fixa (${edm && edm.total} faixas)`);

  // O nome do arquivo é quem diz o que aparece no tocador.
  const primeira = edm.faixas[0];
  check(primeira.titulo === 'Faixa 1 do teste', `"Título - Artista.mp3" vira título (${primeira.titulo})`);
  check(primeira.artista === 'Artista edm', `e artista (${primeira.artista})`);
  check(
    primeira.url.startsWith('/assets/festas/edm/') && primeira.url.includes('%20'),
    `com o endereço escapado, porque nome de música tem espaço (${primeira.url})`
  );
  // O arquivo precisa BAIXAR de verdade nesse endereço - sem isso o player toca
  // silêncio e ninguém entende por quê.
  const baixou = await fetch(url + primeira.url);
  check(
    baixou.status === 200 && (baixou.headers.get('content-type') || '').includes('audio'),
    `e o arquivo baixa nesse endereço (${baixou.status}, ${baixou.headers.get('content-type')})`
  );

  // ============================================== 3. a tela
  const navegador = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    // Deixa o áudio tocar sem clique, como aconteceria depois da primeira
    // interação de qualquer pessoa de verdade.
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const pagina = await (await navegador.newContext({ viewport: { width: 1366, height: 800 } })).newPage();
  const erros = [];
  pagina.on('pageerror', (e) => erros.push(e.message));

  await pagina.goto(url);
  await entrarNoJogo(pagina, 'Festeiro');
  await espera(700);

  check(await pagina.locator('#festas').isVisible(), 'o seletor de festa aparece no menu');
  const botoes = await pagina.locator('.festa-opcao').allTextContents();
  check(botoes.length === 2, `com uma opção por festa (${botoes.join(' | ')})`);
  // O seletor já nasceu invisível uma vez, por colisão de nome de classe com o
  // confete do babuíno. Ver é diferente de existir no DOM.
  const visiveis = await pagina.evaluate(() =>
    [...document.querySelectorAll('.festa-opcao')].map((b) => {
      const r = b.getBoundingClientRect();
      return { largura: Math.round(r.width), opacidade: Number(getComputedStyle(b).opacity) };
    })
  );
  check(
    visiveis.every((v) => v.largura > 90 && v.opacidade > 0.9),
    `e os botões aparecem de verdade (${visiveis.map((v) => `${v.largura}px op:${v.opacidade}`).join(', ')})`
  );
  check(
    botoes.some((t) => /EDM/i.test(t)) && botoes.some((t) => /Summer/i.test(t)),
    'as duas festas pedidas estão lá'
  );

  // Escolher marca a festa e guarda a escolha.
  await pagina.click('.festa-opcao[data-festa="summer-eletro-2000s"]');
  await espera(200);
  check(
    await pagina.locator('.festa-opcao[data-festa="summer-eletro-2000s"]').evaluate((e) =>
      e.classList.contains('festa-opcao--ativa')
    ),
    'clicar numa festa deixa claro qual está escolhida'
  );

  // ============================================== 4. entrar na festa toca
  await pagina.click('#btn-entrar-festa');
  await espera(1200);

  // `position: fixed` sempre tem offsetParent nulo - a visibilidade vem do
  // navegador, não do DOM.
  const tocadorVisivel = await pagina.locator('#tocador').isVisible();
  const tocando = await pagina.evaluate(() => ({
    festa: document.getElementById('tocador-festa').textContent,
    faixa: document.getElementById('tocador-faixa').textContent,
    andando: audio.currentTime > 0,
    pausado: audio.paused,
    src: audio.src,
  }));
  check(tocadorVisivel, 'o tocador aparece');
  check(/Summer/i.test(tocando.festa), `mostrando a festa escolhida (${tocando.festa})`);
  check(tocando.faixa.includes('—'), `e a música da vez (${tocando.faixa})`);
  check(!tocando.pausado && tocando.andando, 'a música está TOCANDO de verdade, não só carregada');
  check(
    tocando.src.includes('/assets/festas/summer-eletro-2000s/'),
    'e o arquivo veio da pasta da festa escolhida'
  );

  // ============================================== 5. a ordem
  //
  // Percorre uma volta inteira da playlist e confere as três promessas: nada de
  // repetir na sequência, todas tocam antes de recomeçar, e a ordem muda a cada
  // partida nova.
  const volta = await pagina.evaluate((quantas) => {
    sortearMusica(); // começo de partida: saco cheio e uma faixa sorteada
    const tocadas = [faixaAtual.arquivo];
    // O resto da volta, mais outra inteira, para ver a virada da rodada.
    for (let i = 0; i < quantas * 2 - 1; i++) {
      proximaFaixa(false);
      tocadas.push(faixaAtual.arquivo);
    }
    return tocadas;
  }, QUANTAS);

  const primeiraVolta = volta.slice(0, QUANTAS);
  check(
    new Set(primeiraVolta).size === QUANTAS,
    `todas as ${QUANTAS} músicas tocam antes de qualquer repetição`
  );
  check(
    volta.every((f, i) => i === 0 || f !== volta[i - 1]),
    'e nenhuma música toca duas vezes seguidas, nem na virada da rodada'
  );

  const outraOrdem = await pagina.evaluate((quantas) => {
    const ordens = [];
    for (let volta = 0; volta < 2; volta++) {
      sortearMusica(); // é o que o jogo chama quando uma partida começa
      const desta = [faixaAtual.arquivo];
      for (let i = 0; i < quantas - 1; i++) { proximaFaixa(false); desta.push(faixaAtual.arquivo); }
      ordens.push(desta.join(','));
    }
    return ordens;
  }, QUANTAS);
  check(outraOrdem[0] !== outraOrdem[1], 'cada partida nova embaralha de novo');

  // ============================================== 6. os controles
  const controles = await pagina.evaluate(async () => {
    const antes = faixaAtual.arquivo;
    document.getElementById('tocador-proxima').click();
    const depois = faixaAtual.arquivo;

    document.getElementById('tocador-play').click(); // pausa
    await new Promise((r) => setTimeout(r, 150));
    const pausou = audio.paused;
    document.getElementById('tocador-play').click(); // volta
    await new Promise((r) => setTimeout(r, 150));

    document.getElementById('tocador-volume').value = '0.3';
    document.getElementById('tocador-volume').dispatchEvent(new Event('input'));

    document.getElementById('btn-mudo').click();
    const mudo = audio.muted;
    document.getElementById('btn-mudo').click();

    return { trocou: antes !== depois, pausou, voltou: !audio.paused, volume: audio.volume, mudo, semMudo: !audio.muted };
  });
  check(controles.trocou, 'o botão de próxima troca de música');
  check(controles.pausou && controles.voltou, 'o play/pausa funciona nos dois sentidos');
  check(Math.abs(controles.volume - 0.3) < 0.01, `o volume obedece (${controles.volume})`);
  check(controles.mudo && controles.semMudo, 'e o mudo liga e desliga');

  const progresso = await pagina.evaluate(async () => {
    if (!Number.isFinite(audio.duration)) {
      await new Promise((pronto) => audio.addEventListener('loadedmetadata', pronto, { once: true }));
    }
    audio.currentTime = audio.duration / 2;
    audio.dispatchEvent(new Event('timeupdate'));
    return parseFloat(document.getElementById('tocador-progresso').style.width);
  });
  check(progresso > 30 && progresso < 70, `a barra de progresso acompanha a música (${progresso}%)`);

  // ============================================== 7. a festa não para no menu
  await pagina.evaluate(() => mostrarTela('entrada'));
  await espera(400);
  check(
    await pagina.evaluate(() => !audio.paused),
    'voltar ao menu não corta a música - a festa continua do outro lado da parede'
  );

  check(erros.length === 0, `nenhum erro de JavaScript ${erros.length ? JSON.stringify(erros.slice(0, 2)) : ''}`);
  await navegador.close();
  encerrar();
  process.exit(falhas ? 1 : 0);
})().catch((e) => {
  console.error('EXPLODIU:', e);
  encerrar();
  process.exit(1);
});
