// O painel de administração: segurança primeiro, dados depois.
// Rode com: node tests/admin.js

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const { criarConta, ambienteDeTeste, emailDeTeste, capturarEmails } = require('./ajuda');
const { io } = require('socket.io-client');

const raiz = path.join(__dirname, '..');
const SENHA = 'senha-secreta-do-admin';
const PORTA_SEM = 3995; // servidor SEM ADMIN_SEGREDO
const PORTA_COM = 3996; // servidor COM ADMIN_SEGREDO
const semUrl = `http://localhost:${PORTA_SEM}`;
const comUrl = `http://localhost:${PORTA_COM}`;

const semAdmin = spawn('node', ['server/index.js'], { cwd: raiz, env: ambienteDeTeste(PORTA_SEM) });
const comAdmin = spawn('node', ['server/index.js'], {
  cwd: raiz,
  env: ambienteDeTeste(PORTA_COM, { ADMIN_SEGREDO: SENHA }),
});
const caixa = capturarEmails(comAdmin);

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const pedir = (s, ev, d = {}) => new Promise((r) => s.emit(ev, d, r));
let falhas = 0;
const check = (c, m) => { console.log(`${c ? 'ok   ' : 'FALHA'}  ${m}`); if (!c) falhas++; };
const encerrar = () => { semAdmin.kill(); comAdmin.kill(); };

const comSenha = (senha) =>
  fetch(`${comUrl}/api/admin/dados`, { headers: { Authorization: `Bearer ${senha}` } });

(async () => {
  await espera(2500);

  // ============================================ 1. sem ADMIN_SEGREDO, não existe
  const paginaFechada = await fetch(`${semUrl}/admin`);
  check(paginaFechada.status === 404, `sem ADMIN_SEGREDO, /admin responde 404 (foi ${paginaFechada.status})`);
  const dadosFechados = await fetch(`${semUrl}/api/admin/dados`);
  check(dadosFechados.status === 404, 'e a rota de dados também não existe');

  // O jogo em si continua normal nesse servidor.
  const jogoOk = await fetch(`${semUrl}/api/animais`).then((r) => r.json());
  check(jogoOk.animais.length === 12, 'o jogo continua funcionando sem o painel');

  // ============================================ 2. com senha, mas errada
  check((await comSenha('')).status === 401, 'senha vazia é recusada');
  check((await comSenha('chute')).status === 401, 'senha errada é recusada');
  check(
    (await fetch(`${comUrl}/api/admin/dados`)).status === 401,
    'sem cabeçalho nenhum é recusado'
  );
  // Quase certa também não passa (a comparação é do valor inteiro).
  check((await comSenha(SENHA.slice(0, -1))).status === 401, 'senha quase certa é recusada');

  // O freio de tentativas entra depois de algumas tentativas seguidas.
  let bloqueou = false;
  for (let i = 0; i < 14; i++) {
    if ((await comSenha('forca-bruta')).status === 429) { bloqueou = true; break; }
  }
  check(bloqueou, 'o freio de tentativas bloqueia força bruta (429)');
  // ...e a senha certa continua entrando mesmo com o freio acionado: ele é para
  // quem chuta, não para quem já acertou.
  check((await comSenha(SENHA)).status === 200, 'a senha certa passa mesmo com o freio acionado');

  // ============================================ 3. dados de verdade
  // Cria duas contas e joga uma partida, para o painel ter o que mostrar.
  const a = await criarConta(comUrl, 'Victor');
  const b = await criarConta(comUrl, 'Jorge');
  // O ranking so mostra quem confirmou o e-mail, entao os dois confirmam - pelo
  // caminho de verdade, abrindo o link que o servidor mandou.
  for (const nome of ['Victor', 'Jorge']) {
    let link = null;
    for (let i = 0; i < 60 && !link; i++) {
      link = caixa.link(emailDeTeste(nome), 'verificar');
      if (!link) await espera(60);
    }
    await fetch(link, { redirect: 'manual' });
  }
  const s1 = io(comUrl, { auth: { token: a.token } });
  const s2 = io(comUrl, { auth: { token: b.token } });
  await Promise.all([s1, s2].map((s) => new Promise((r) => s.once('connect', r))));

  const estados = new Map();
  s1.on('estado-atualizado', (e) => estados.set('a', e));
  s2.on('estado-atualizado', (e) => estados.set('b', e));

  const sala = await pedir(s1, 'criar-sala');
  await pedir(s2, 'entrar-sala', { codigo: sala.sala.codigo });
  await pedir(s1, 'iniciar-partida');
  await espera(300);

  for (let i = 0; i < 30; i++) {
    const e = estados.get('a');
    if (!e || e.fase === 'terminado') break;
    const souEu = e.vezDe === a.usuario.id;
    const visao = souEu ? estados.get('a') : estados.get('b');
    const mao = visao.jogadores.find((j) => j.id === e.vezDe).mao;
    if (!mao || !mao.length) break;
    const carta = mao[0];
    const escolha =
      carta.animal === 'tucano' && visao.fila[0] ? { alvoUid: visao.fila[0].uid }
      : carta.animal === 'coelho' ? { pulos: 1 }
      : carta.animal === 'polvo' && visao.fila[0] ? { especie: visao.fila.find((c) => c.animal !== 'polvo')?.animal }
      : null;
    const r = await pedir(souEu ? s1 : s2, 'jogar-carta', { uid: carta.uid, escolha });
    if (!r.ok) break;
    await espera(20);
  }
  await espera(500);
  [s1, s2].forEach((s) => s.disconnect());

  const dados = await comSenha(SENHA).then((r) => r.json());
  check(dados.ok, 'com a senha certa, os dados chegam');
  check(dados.contas.length === 2, `as 2 contas aparecem (${dados.contas.map((c) => c.nome).join(', ')})`);
  check(dados.totais.partidas >= 1, `a partida jogada aparece (${dados.totais.partidas})`);
  check(dados.partidas[0] && dados.partidas[0].quem, `com quem jogou: ${dados.partidas[0]?.quem}`);
  check(dados.ranking.length === 2, 'e o ranking da semana');

  // A trava que mais importa: nada de senha, em lugar nenhum da resposta.
  const bruto = JSON.stringify(dados);
  check(!bruto.includes('senha_hash'), 'a resposta NÃO traz senha_hash');
  check(!bruto.includes('senha_sal'), 'a resposta NÃO traz senha_sal');
  check(!bruto.includes('senha-de-teste'), 'nem a senha em texto puro');
  // As duas colunas que jamais podem sair. (senha_trocada_em pode: é só a data
  // da última troca, útil para o administrador notar movimento estranho.)
  check(
    dados.contas.every((c) => !('senha_hash' in c) && !('senha_sal' in c)),
    'nenhuma coluna de senha nas contas'
  );
  check(
    'senha_trocada_em' in dados.contas[0],
    'mas a data da última troca de senha aparece, para dar visibilidade'
  );

  // ============================================ 4. a página no navegador
  const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const pagina = await (await navegador.newContext({ viewport: { width: 1100, height: 800 } })).newPage();
  const erros = [];
  pagina.on('pageerror', (e) => erros.push(e.message));

  await pagina.goto(`${comUrl}/admin`);
  await espera(500);
  check(await pagina.locator('#entrada').isVisible(), 'a página pede senha antes de mostrar qualquer coisa');
  check(!(await pagina.locator('#painel').isVisible()), 'e o painel começa escondido');

  // O HTML servido não pode conter dado nenhum antes do login.
  const htmlCru = await fetch(`${comUrl}/admin`).then((r) => r.text());
  check(!htmlCru.includes('Victor'), 'o HTML da página não traz dados embutidos');
  check(!htmlCru.includes(SENHA), 'nem a senha de administrador');

  await pagina.fill('#senha', 'errada');
  await pagina.click('#entrar');
  await espera(600);
  check((await pagina.textContent('#aviso')).length > 0, `senha errada avisa: "${await pagina.textContent('#aviso')}"`);
  check(!(await pagina.locator('#painel').isVisible()), 'e não abre o painel');

  await pagina.fill('#senha', SENHA);
  await pagina.click('#entrar');
  await pagina.waitForSelector('#painel:not(.escondido)', { timeout: 10000 });
  check(true, 'com a senha certa, o painel abre');

  const texto = await pagina.textContent('#contas');
  check(texto.includes('Victor') && texto.includes('Jorge'), 'as contas aparecem na tabela');
  check((await pagina.textContent('#ranking')).includes('pts'), 'o ranking aparece com os pontos');
  check((await pagina.textContent('#partidas')).length > 10, 'as últimas partidas aparecem');
  check(!(await pagina.content()).includes('senha_hash'), 'nada de hash na tela');

  await pagina.screenshot({ path: path.join(raiz, 'shot-admin.png'), fullPage: true });

  // Sair limpa a sessão da aba.
  await pagina.click('#sair');
  await espera(300);
  check(await pagina.locator('#entrada').isVisible(), 'o botão sair volta para a tela de senha');
  await pagina.reload();
  await espera(600);
  check(await pagina.locator('#entrada').isVisible(), 'e o F5 depois de sair não entra sozinho');

  check(erros.length === 0, `nenhum erro de JavaScript ${erros.length ? JSON.stringify(erros.slice(0, 2)) : ''}`);

  await navegador.close();
  encerrar();
  process.exit(falhas ? 1 : 0);
})().catch((e) => {
  console.error('EXPLODIU:', e);
  encerrar();
  process.exit(1);
});
