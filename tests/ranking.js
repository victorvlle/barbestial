// Contas e ranking no navegador de verdade.
// Rode com: node tests/ranking.js
//
// Cobre o que os testes de unidade nao alcancam: a tela de login, a sessao que
// sobrevive ao F5, o logout, o painel do ranking se atualizando sozinho quando
// uma partida termina, e as mesas de 2, 3 e 4 jogadores pontuando certo.

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const { criarConta, ambienteDeTeste, entrarNoJogo, crachaDeTeste } = require('./ajuda');
const { io } = require('socket.io-client');

const raiz = path.join(__dirname, '..');
const PORTA = 3993;
const url = `http://localhost:${PORTA}`;
const servidor = spawn('node', ['server/index.js'], { cwd: raiz, env: ambienteDeTeste(PORTA) });

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const pedir = (s, ev, d = {}) => new Promise((r) => s.emit(ev, d, r));
let falhas = 0;
const check = (c, m) => { console.log(`${c ? 'ok   ' : 'FALHA'}  ${m}`); if (!c) falhas++; };

// Joga uma partida inteira por socket, com N jogadores, e devolve as contas.
// E o mesmo caminho da interface, so que sem clicar - o que interessa aqui e o
// resultado chegar ao ranking, nao o clique.
async function partidaCompleta(quantos, prefixo) {
  const contas = [];
  for (let i = 0; i < quantos; i++) {
    const conta = await criarConta(url, `${prefixo}${i + 1}`);
    const socket = io(url, { auth: { token: conta.token } });
    await new Promise((pronto, erro) => {
      socket.once('connect', pronto);
      socket.once('connect_error', erro);
    });
    contas.push({ ...conta.usuario, socket });
  }

  const estados = new Map();
  contas.forEach((c) => c.socket.on('estado-atualizado', (e) => estados.set(c.id, e)));

  const criada = await pedir(contas[0].socket, 'criar-sala');
  for (const c of contas.slice(1)) await pedir(c.socket, 'entrar-sala', { codigo: criada.sala.codigo });
  await pedir(contas[0].socket, 'iniciar-partida');
  await espera(300);

  // A escolha que cada carta exige, igual ao que main.js monta.
  const escolhaPara = (carta, estado) => {
    if (estado.fila.length === 0) return null;
    if (carta.animal === 'tucano') return { alvoUid: estado.fila[0].uid };
    if (carta.animal === 'coelho') return { pulos: 1 };
    if (carta.animal === 'polvo') {
      const especies = [...new Set(estado.fila.map((c) => c.animal))].filter((e) => e !== 'polvo');
      if (!especies.length) return null;
      const dados = { especie: especies[0] };
      if (especies[0] === 'tucano') dados.alvoUid = estado.fila[0].uid;
      if (especies[0] === 'coelho') dados.pulos = 1;
      return dados;
    }
    return null;
  };

  let voltas = 0;
  while (voltas < 12 * quantos + 5) {
    const algum = estados.get(contas[0].id);
    if (!algum || algum.fase === 'terminado') break;
    const daVez = contas.find((c) => c.id === algum.vezDe);
    const visao = estados.get(daVez.id);
    const mao = visao.jogadores.find((j) => j.id === daVez.id).mao;
    if (!mao || !mao.length) break;
    const carta = mao[0];
    const r = await pedir(daVez.socket, 'jogar-carta', {
      uid: carta.uid,
      escolha: escolhaPara(carta, visao),
    });
    if (!r.ok) break;
    await espera(20);
    voltas++;
  }

  const final = estados.get(contas[0].id);
  await espera(400); // o servidor grava o resultado logo depois de avisar
  contas.forEach((c) => c.socket.disconnect());
  return { contas, final };
}

const buscarRanking = () => fetch(`${url}/api/ranking`).then((r) => r.json());

(async () => {
  await espera(2500);

  // ================================================== 1. as rotas de conta
  const config = await fetch(`${url}/api/conta/config`).then((r) => r.json());
  check(config.ok, 'o servidor diz como dá para entrar');
  check(config.google === true, 'o login com Google está disponível');
  check(config.modoTeste === true, 'e este servidor está em modo de teste (crachás falsos)');
  // O que sai daqui é público por natureza. A checagem é por lista fechada:
  // qualquer campo novo que alguém adicione sem pensar faz este teste falhar.
  check(
    JSON.stringify(Object.keys(config).sort()) ===
      JSON.stringify(['google', 'googleClientId', 'modoTeste', 'ok', 'senhaMinima']),
    `a configuração pública só tem campos públicos (${Object.keys(config).join(', ')})`
  );

  // E o freio de tentativas: só erro conta, e ele bloqueia mesmo.
  let travou = false;
  for (let i = 0; i < 14; i++) {
    const r = await fetch(`${url}/api/conta/entrar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: 'NaoExiste', senha: 'chute' }),
    }).then((r) => r.json());
    if (/Muitas tentativas/.test(r.erro || '')) { travou = true; break; }
  }
  check(travou, 'o freio bloqueia quem fica chutando senha');
  await espera(61000); // deixa a janela do freio expirar antes de seguir

  const semSessao = await fetch(`${url}/api/conta/eu`);
  check(semSessao.status === 401, 'sem cracha, /api/conta/eu responde 401');

  const tokenFalso = await fetch(`${url}/api/conta/eu`, {
    headers: { Authorization: 'Bearer inventado.123.abc' },
  });
  check(tokenFalso.status === 401, 'cracha inventado também é recusado');

  const googleRuim = await fetch(`${url}/api/conta/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: 'nao-e-um-token-do-google' }),
  }).then((r) => r.json());
  check(!googleRuim.ok, `token falso do Google é recusado: "${googleRuim.erro}"`);

  // ================================================== 2. login pela tela
  const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const contexto = await navegador.newContext({ viewport: { width: 1366, height: 800 } });
  const pagina = await contexto.newPage();

  const erros = [];
  const doYoutube = (t) => /youtube|ytimg|iframe_api|ERR_TUNNEL|accounts\.google/i.test(t);
  pagina.on('pageerror', (e) => !doYoutube(e.message) && erros.push(e.message));

  await pagina.goto(url);
  await espera(700);

  check(await pagina.locator('#tela-login').isVisible(), 'a tela de login aparece para quem não entrou');
  check(
    !(await pagina.locator('#btn-criar').isEnabled().catch(() => false)) ||
      (await pagina.locator('#tela-login').isVisible()),
    'o menu do jogo fica atrás da tela de login'
  );

  // Cadastro: os TRÊS são obrigatórios. Sem o Google, o botão nem habilita.
  await pagina.click('.aba[data-modo="criar"]');
  await pagina.fill('#novo-nome', 'Victor');
  await pagina.fill('#nova-senha', 'senha-de-teste');
  check(
    await pagina.locator('#btn-criar-conta').isDisabled(),
    'sem conectar o Google, o botão de criar conta fica desabilitado'
  );

  // Senha curta demais: o servidor recusa e a tela explica.
  await pagina.fill('#nova-senha', '12');
  await pagina.evaluate((c) => aoReceberDoGoogle({ credential: c }), crachaDeTeste('CurtaTeste'));
  await pagina.click('#btn-criar-conta');
  await espera(500);
  check(
    (await pagina.textContent('#aviso-login')).includes('6'),
    `senha curta é recusada com explicação: "${await pagina.textContent('#aviso-login')}"`
  );
  await pagina.click('.aba[data-modo="entrar"]');

  await entrarNoJogo(pagina, 'Victor');
  check(!(await pagina.locator('#tela-login').isVisible()), 'depois de criar a conta, entra no jogo');
  check((await pagina.textContent('#quem-sou')).trim() === 'Victor', 'a tela mostra quem está jogando');

  // Recarregar não pede login de novo: é a sessão fazendo o trabalho dela.
  await pagina.reload();
  await espera(1200);
  check(!(await pagina.locator('#tela-login').isVisible()), 'a sessão sobrevive ao F5');
  check((await pagina.textContent('#quem-sou')).trim() === 'Victor', 'e continua sendo a mesma conta');

  // Entrar de novo com a mesma conta acha a conta que já existe.
  const denovo = await fetch(`${url}/api/conta/entrar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: 'Victor', senha: 'senha-de-teste' }),
  }).then((r) => r.json());
  check(denovo.ok, 'dá para entrar de novo na conta já criada');

  // ...e pelo Google também, com um clique só.
  const peloGoogle = await fetch(`${url}/api/conta/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: crachaDeTeste('Victor') }),
  }).then((r) => r.json());
  check(peloGoogle.ok && peloGoogle.usuario.nome === 'Victor', 'e pelo Google, com um clique');

  // ============================ RECUPERAÇÃO DE SENHA
  // A trava principal: saber o apelido não abre nada.
  const soComApelido = await fetch(`${url}/api/conta/recuperar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: 'Victor', novaSenha: 'invadido123' }),
  }).then((r) => r.json());
  check(!soComApelido.ok, 'não dá para recuperar a senha só com o apelido');

  // Um estranho com o PRÓPRIO Google não alcança a conta da vítima.
  await criarConta(url, 'Estranho');
  const tentativa = await fetch(`${url}/api/conta/recuperar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: crachaDeTeste('Estranho'), novaSenha: 'invadido123' }),
  }).then((r) => r.json());
  check(tentativa.ok, 'o estranho troca a senha DELE (é a conta dele)');
  const vitimaIntacta = await fetch(`${url}/api/conta/entrar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: 'Victor', senha: 'senha-de-teste' }),
  }).then((r) => r.json());
  check(vitimaIntacta.ok, 'e a senha do Victor continua a mesma');

  // Com o Google certo, a recuperação funciona.
  const recuperou = await fetch(`${url}/api/conta/recuperar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: crachaDeTeste('Victor'), novaSenha: 'senha-nova-123' }),
  }).then((r) => r.json());
  check(recuperou.ok && recuperou.token, 'com o Google certo, a senha é redefinida e já entra');

  const senhaVelha = await fetch(`${url}/api/conta/entrar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: 'Victor', senha: 'senha-de-teste' }),
  }).then((r) => r.json());
  check(!senhaVelha.ok, 'e a senha antiga para de funcionar');

  const eu = await fetch(`${url}/api/conta/eu`, {
    headers: { Authorization: `Bearer ${denovo.token}` },
  }).then((r) => r.json());
  check(eu.ok && eu.usuario.nome === 'Victor', 'o cracha identifica a conta certa');

  // ================================================== 3. o painel do ranking
  check(await pagina.locator('#ranking').isVisible(), 'o painel do ranking aparece na tela principal');
  check(
    (await pagina.textContent('#ranking-lista')).includes('Nenhuma partida'),
    'sem partidas na semana, o painel explica em vez de ficar vazio'
  );
  const lugar = await pagina.evaluate(() => {
    const r = document.querySelector('#ranking').getBoundingClientRect();
    const p = document.querySelector('#tela-entrada .painel').getBoundingClientRect();
    return { rankingAEsquerda: r.left > p.right, dentroDaTela: r.right <= innerWidth + 1 };
  });
  check(lugar.rankingAEsquerda, 'o ranking fica à direita, sem cobrir o painel do jogo');
  check(lugar.dentroDaTela, 'e cabe na tela');

  // ================================================== 4. mesa de 2
  const dupla = await partidaCompleta(2, 'Dupla');
  check(dupla.final.fase === 'terminado', 'a partida de 2 jogadores terminou');

  let tabela = await buscarRanking();
  const naTabela = (id) => tabela.ranking.find((l) => l.id === id);
  const pontosDupla = dupla.contas.map((c) => naTabela(c.id)?.pontos ?? null);
  check(
    JSON.stringify(pontosDupla.slice().sort()) === JSON.stringify([0, 1]),
    `mesa de 2: um leva 1 ponto e o outro 0 (foi ${pontosDupla.join(' e ')})`
  );

  // ================================================== 5. mesa de 3
  const trio = await partidaCompleta(3, 'Trio');
  tabela = await buscarRanking();
  const pontosTrio = trio.contas.map((c) => tabela.ranking.find((l) => l.id === c.id)?.pontos ?? null);
  check(
    JSON.stringify(pontosTrio.slice().sort()) === JSON.stringify([0, 1, 2]),
    `mesa de 3: 2, 1 e 0 (foi ${pontosTrio.join(', ')})`
  );

  // ================================================== 6. mesa de 4
  const quarteto = await partidaCompleta(4, 'Quarteto');
  tabela = await buscarRanking();
  const pontosQuarteto = quarteto.contas
    .map((c) => tabela.ranking.find((l) => l.id === c.id)?.pontos ?? null)
    .sort((a, b) => a - b);
  check(
    JSON.stringify(pontosQuarteto) === JSON.stringify([1, 2, 3, 5]),
    `mesa de 4: a tabela padrão 5, 3, 2, 1 (foi ${pontosQuarteto.join(', ')})`
  );

  // ================================================== 7. atualiza sozinho
  // A página está aberta desde antes de qualquer partida. Se o painel mostra os
  // jogadores agora, é porque o servidor avisou e ela se redesenhou sozinha -
  // ninguém recarregou nada.
  await espera(600);
  const noPainel = await pagina.locator('#ranking-lista .ranking-linha').count();
  check(noPainel >= 4, `o painel se atualizou sozinho durante as partidas (${noPainel} jogadores)`);

  const primeiro = await pagina.locator('.ranking-linha').first().textContent();
  check(/\d+\s*pts/.test(primeiro), `o painel mostra os pontos ("${primeiro.trim()}")`);
  check(
    (await pagina.locator('#ranking-periodo').textContent()).trim().length > 0,
    'e o período da semana'
  );

  // Ordenado do maior para o menor?
  const pontosNaTela = await pagina.locator('.ranking-pontos').allTextContents();
  const numeros = pontosNaTela.map((t) => Number(t.replace(/\D/g, '')));
  check(
    numeros.every((n, i) => i === 0 || numeros[i - 1] >= n),
    `o ranking está em ordem decrescente (${numeros.join(', ')})`
  );

  // Rolagem quando a lista cresce: o painel não pode esticar para fora da tela.
  const rolagem = await pagina.evaluate(() => {
    const l = document.querySelector('#ranking-lista');
    return { rola: getComputedStyle(l).overflowY, cabe: l.getBoundingClientRect().bottom <= innerHeight + 1 };
  });
  check(rolagem.rola === 'auto' || rolagem.rola === 'scroll', 'a lista rola quando cresce');
  check(rolagem.cabe, 'o painel não vaza para fora da tela');

  await pagina.screenshot({ path: path.join(raiz, 'shot-ranking.png') });

  // ================================================== 8. virada de semana
  // A semana passada tem que continuar consultável, e a atual não pode herdar
  // ponto nenhum dela.
  const semanas = await fetch(`${url}/api/ranking/semanas`).then((r) => r.json());
  check(semanas.ok && semanas.semanas.length >= 1, 'o histórico de semanas existe');

  const outraSemana = await fetch(`${url}/api/ranking?semana=1999-S01`).then((r) => r.json());
  check(outraSemana.ok && outraSemana.ranking.length === 0, 'uma semana sem partidas vem vazia');
  check(
    tabela.ranking.length > 0,
    'enquanto a semana atual continua com os pontos desta semana'
  );

  // ================================================== 9. logout
  await pagina.click('#btn-sair-conta');
  await espera(500);
  check(await pagina.locator('#tela-login').isVisible(), 'o logout leva de volta para a tela de login');
  await pagina.reload();
  await espera(1200);
  check(
    await pagina.locator('#tela-login').isVisible(),
    'e depois do logout o F5 não entra de novo sozinho'
  );

  check(erros.length === 0, `nenhum erro de JavaScript ${erros.length ? JSON.stringify(erros.slice(0, 3)) : ''}`);

  await navegador.close();
  servidor.kill();
  process.exit(falhas ? 1 : 0);
})().catch((e) => {
  console.error('EXPLODIU:', e);
  servidor.kill();
  process.exit(1);
});
