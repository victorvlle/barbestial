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
//   * os controles do som do bar funcionam

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

// Só as duas primeiras festas ganham arquivo. As outras seis ficam vazias de
// propósito: é assim que dá para testar que festa sem música não aparece.
const COM_MUSICA = ['edm', 'summer-eletro-2000s'];

function gerarFaixas() {
  for (const festa of FESTAS.filter((f) => COM_MUSICA.includes(f.id))) {
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
  check(catalogo.ok && catalogo.festas.length === 8, `o servidor lista as 8 festas registradas (${catalogo.festas.length})`);
  const edm = catalogo.festas.find((f) => f.id === 'edm');
  check(edm && edm.total === QUANTAS, `a playlist sai da PASTA, não de uma lista fixa (${edm && edm.total} faixas)`);

  // O nome do arquivo é quem diz o que aparece no som do bar.
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
  // Oito festas estão registradas, mas só as que TÊM arquivo aparecem: oferecer
  // uma festa vazia é prometer silêncio.
  check(botoes.length === 2, `só as festas com música aparecem (${botoes.join(' | ')})`);
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

  // ============================================== 4. o menu é silêncio
  //
  // Escolher a festa não toca nada. A música é da MESA: começa quando a partida
  // começa e para quando você volta para o menu.
  check(
    await pagina.evaluate(() => audio.paused && !faixaAtual),
    'escolher a festa no menu não começa a tocar nada'
  );
  check(await pagina.locator('#som').isHidden(), 'e o som do bar nem aparece no menu');
  check(
    (await pagina.locator('#btn-entrar-festa').count()) === 0,
    'não existe mais botão de "entrar na festa"'
  );

  // Agora sim: a partida começa. É o mesmo caminho que o jogo usa.
  await pagina.evaluate(() => { mostrarTela('jogo'); sortearMusica(); });
  await espera(1500);

  // `position: fixed` sempre tem offsetParent nulo - a visibilidade vem do
  // navegador, não do DOM.
  const somVisivel = await pagina.locator('#som').isVisible();
  const tocando = await pagina.evaluate(() => ({
    festa: document.getElementById('som-festa').textContent,
    faixa: document.getElementById('som-faixa').textContent,
    andando: audio.currentTime > 0,
    pausado: audio.paused,
    src: audio.src,
  }));
  check(somVisivel, 'começou a partida: o som aparece no painel do bar');
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
    // Compacto por padrão: quem quiser os controles precisa abrir.
    document.getElementById('som-face').click();
    const antes = faixaAtual.arquivo;
    document.getElementById('som-proxima').click();
    const depois = faixaAtual.arquivo;

    document.getElementById('som-play').click(); // pausa
    await new Promise((r) => setTimeout(r, 150));
    const pausou = audio.paused;
    document.getElementById('som-play').click(); // volta
    await new Promise((r) => setTimeout(r, 150));

    document.getElementById('som-volume').value = '0.3';
    document.getElementById('som-volume').dispatchEvent(new Event('input'));

    document.getElementById('btn-mudo').click();
    const mudo = audio.muted;
    document.getElementById('btn-mudo').click();

    document.getElementById('som-face').click(); // fecha de novo

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
    return parseFloat(document.getElementById('som-progresso').style.width);
  });
  check(progresso > 30 && progresso < 70, `a barra de progresso acompanha a música (${progresso}%)`);

  // ============================================== 6b. o som É DO BAR
  //
  // A música saiu do canto de baixo à direita e virou uma informação do
  // ambiente, no rodapé do painel do BAR. O que este bloco confere é
  // exatamente o que muda com isso: existe UM ponto de música só, ele mora
  // dentro do bar, nasce compacto, abre quando o jogador pede, e o
  // equalizador conta se a música está tocando ou parada.
  const ondeMora = await pagina.evaluate(() => {
    const som = document.getElementById('som');
    const bar = document.querySelector('.zona--bar');
    const c = som.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    return {
      dentroDoBar: bar.contains(som),
      // "dentro" de verdade, na tela: o bloco todo cabe no painel do bar.
      encaixado: c.top >= b.top - 1 && c.bottom <= b.bottom + 1 && c.left >= b.left - 1 && c.right <= b.right + 1,
      // Um player só na página inteira - nada de sobra do antigo.
      quantosPlayers: document.querySelectorAll('.som, .tocador').length,
      sobrouOAntigo: Boolean(document.getElementById('tocador')),
      altura: Math.round(c.height),
    };
  });
  check(ondeMora.dentroDoBar && ondeMora.encaixado, 'a música mora dentro do painel do BAR');
  check(ondeMora.quantosPlayers === 1 && !ondeMora.sobrouOAntigo, 'e existe UM ponto de música só - o antigo saiu');
  check(ondeMora.altura < 110, `compacto, sem roubar a coluna do bar (${ondeMora.altura}px de altura)`);

  // Nada do que importa no jogo pode ficar embaixo dele.
  const cobre = await pagina.evaluate(() => {
    const bate = (a, b) => a && b && !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    const som = document.getElementById('som').getBoundingClientRect();
    const alvos = { fila: '#fila', mao: '#mao', ralo: '#ralo', registro: '#log', reacoes: '#bloco-reacoes', relogio: '#relogio', placar: '#placar' };
    return Object.entries(alvos)
      .filter(([, sel]) => bate(som, document.querySelector(sel)?.getBoundingClientRect()))
      .map(([nome]) => nome);
  });
  check(cobre.length === 0, `não cobre nada do jogo ${cobre.join(', ')}`);

  // Compacto por padrão; clicar abre os controles; clicar de novo fecha.
  const abreEFecha = await pagina.evaluate(async () => {
    const som = document.getElementById('som');
    const controles = document.getElementById('som-controles');
    const face = document.getElementById('som-face');
    const comeca = controles.classList.contains('escondida');
    face.click();
    await new Promise((r) => setTimeout(r, 150));
    const abriu = !controles.classList.contains('escondida') && som.classList.contains('som--aberto');
    const aria = face.getAttribute('aria-expanded');
    face.click();
    await new Promise((r) => setTimeout(r, 150));
    return { comeca, abriu, aria, fechou: controles.classList.contains('escondida') };
  });
  check(abreEFecha.comeca, 'nasce compacto: os controles ficam guardados');
  check(abreEFecha.abriu && abreEFecha.aria === 'true', 'clicar expande e mostra os controles');
  check(abreEFecha.fechou, 'e clicar de novo volta ao compacto');

  // O equalizador é o sinal de "está tocando": pausou, ele para.
  const equalizador = await pagina.evaluate(async () => {
    const som = document.getElementById('som');
    const barras = document.querySelectorAll('#som-eq i').length;
    const rodando = () => getComputedStyle(document.querySelector('#som-eq i')).animationPlayState;
    const tocandoAgora = { estado: document.getElementById('som-estado').textContent, eq: rodando(), classe: som.classList.contains('som--tocando') };
    document.getElementById('som-play').click(); // pausa
    await new Promise((r) => setTimeout(r, 250));
    const pausado = { estado: document.getElementById('som-estado').textContent, eq: rodando(), classe: som.classList.contains('som--tocando') };
    document.getElementById('som-play').click(); // volta
    await new Promise((r) => setTimeout(r, 250));
    return { barras, tocandoAgora, pausado, voltou: !audio.paused };
  });
  check(equalizador.barras >= 8, `a onda do som tem barrinhas (${equalizador.barras})`);
  check(
    /tocando/i.test(equalizador.tocandoAgora.estado) && equalizador.tocandoAgora.eq === 'running',
    `tocando: o estado diz "${equalizador.tocandoAgora.estado.trim()}" e as barras andam`
  );
  check(
    /pausado/i.test(equalizador.pausado.estado) && equalizador.pausado.eq === 'paused',
    `pausado: o estado diz "${equalizador.pausado.estado.trim()}" e as barras param`
  );
  check(equalizador.voltou, 'e voltar a tocar religa tudo');

  // Música nova = um pisca curto no bloco. A classe entra e sai sozinha.
  const troca = await pagina.evaluate(async () => {
    const som = document.getElementById('som');
    som.classList.remove('som--nova');
    const antes = document.getElementById('som-faixa').textContent;
    document.getElementById('som-proxima').click();
    const piscou = som.classList.contains('som--nova');
    const depois = document.getElementById('som-faixa').textContent;
    await new Promise((r) => setTimeout(r, 1700));
    return { piscou, mudouONome: antes !== depois, saiuSozinha: !som.classList.contains('som--nova') };
  });
  check(troca.piscou && troca.mudouONome, 'música nova: o nome troca e o bloco dá um pisca');
  check(troca.saiuSozinha, 'e o pisca sai sozinho, para poder acontecer de novo');

  await pagina.screenshot({ path: path.join(raiz, 'shot-som-bar.png') });

  // ============================================== 7. voltar ao menu para a festa
  await pagina.evaluate(() => mostrarTela('entrada'));
  await espera(400);
  check(
    await pagina.evaluate(() => audio.paused),
    'voltar ao menu para a música - o menu é silêncio'
  );
  check(await pagina.locator('#som').isHidden(), 'e o som do bar some junto');

  check(erros.length === 0, `nenhum erro de JavaScript ${erros.length ? JSON.stringify(erros.slice(0, 2)) : ''}`);
  await navegador.close();
  encerrar();
  process.exit(falhas ? 1 : 0);
})().catch((e) => {
  console.error('EXPLODIU:', e);
  encerrar();
  process.exit(1);
});
