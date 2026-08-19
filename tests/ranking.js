// Contas por e-mail e ranking, num navegador de verdade.
// Rode com: node tests/ranking.js
//
// Cobre o que os testes de unidade nao alcancam: a tela de login com os quatro
// modos, o e-mail de confirmacao chegando com o link certo, a recuperacao de
// senha inteira (pedir -> abrir o link -> senha nova -> a antiga morre), a
// sessao que sobrevive ao F5, o logout, e o painel do ranking se atualizando
// sozinho quando uma partida termina.
//
// A CAIXA DE ENTRADA: sem SMTP configurado o servidor imprime cada e-mail no
// console. Os testes leem a saida do servidor de teste (ajuda.capturarEmails) e
// clicam nos links de la. Nao existe nenhuma rota de teste no servidor: o
// caminho exercitado aqui e exatamente o de producao.

// Este arquivo importa as REGRAS de pontuação do servidor (posicionar +
// pontosDaPosicao) para conferir a mesa contra o que de fato aconteceu, em vez
// de chutar um placar. Importar aquele módulo abre um banco; apontamos para a
// memória para não encostar em arquivo nenhum deste computador.
process.env.BANCO_CAMINHO = ':memory:';

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const {
  criarConta,
  ambienteDeTeste,
  entrarNoJogo,
  emailDeTeste,
  capturarEmails,
} = require('./ajuda');
const { io } = require('socket.io-client');
const { posicionar, pontosDaPosicao } = require('../server/dados/ranking');

const raiz = path.join(__dirname, '..');
const PORTA = 3993;
const url = `http://localhost:${PORTA}`;
const servidor = spawn('node', ['server/index.js'], { cwd: raiz, env: ambienteDeTeste(PORTA) });
const caixa = capturarEmails(servidor);

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const pedir = (s, ev, d = {}) => new Promise((r) => s.emit(ev, d, r));
let falhas = 0;
const check = (c, m) => { console.log(`${c ? 'ok   ' : 'FALHA'}  ${m}`); if (!c) falhas++; };

const postar = (rota, corpo, cracha) =>
  fetch(`${url}/api/conta/${rota}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cracha ? { Authorization: `Bearer ${cracha}` } : {}),
    },
    body: JSON.stringify(corpo),
  }).then((r) => r.json());

// Abre o link de confirmacao como o navegador faria. Devolve para onde o
// servidor mandou a pessoa depois: /?verificado=1 (deu certo) ou 0 (nao valeu).
async function abrirLink(link) {
  const resposta = await fetch(link, { redirect: 'manual' });
  return resposta.headers.get('location') || '';
}

// O console do servidor e um cano: o e-mail pode demorar uns milissegundos para
// chegar aqui. Em vez de chutar um sleep, esperamos o link aparecer.
async function esperarLink(endereco, tipo, limite = 4000) {
  const fim = Date.now() + limite;
  while (Date.now() < fim) {
    const link = caixa.link(endereco, tipo);
    if (link) return link;
    await espera(60);
  }
  return null;
}

// Cria a conta E confirma o e-mail, pelo caminho de verdade: le o link que o
// servidor mandou e abre. O ranking so mostra quem confirmou.
async function contaConfirmada(nome) {
  const conta = await criarConta(url, nome);
  await abrirLink(await esperarLink(emailDeTeste(nome), 'verificar'));
  return conta;
}

// Joga uma partida inteira por socket, com N jogadores, e devolve as contas.
// E o mesmo caminho da interface, so que sem clicar - o que interessa aqui e o
// resultado chegar ao ranking, nao o clique.
async function partidaCompleta(quantos, prefixo, { confirmar = true } = {}) {
  const contas = [];
  for (let i = 0; i < quantos; i++) {
    const nome = `${prefixo}${i + 1}`;
    const conta = confirmar ? await contaConfirmada(nome) : await criarConta(url, nome);
    const socket = io(url, { auth: { token: conta.token } });
    await new Promise((pronto, erro) => {
      socket.once('connect', pronto);
      socket.once('connect_error', erro);
    });
    contas.push({ ...conta.usuario, nomeDeTeste: nome, socket });
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
  check(config.email === false, 'sem SMTP configurado, os links saem no log (é o modo de teste)');
  // O que sai daqui é público por natureza. A checagem é por lista fechada:
  // qualquer campo novo que alguém adicione sem pensar faz este teste falhar.
  // NENHUM segredo pode passar por esta porta.
  check(
    JSON.stringify(Object.keys(config).sort()) === JSON.stringify(['email', 'ok', 'senhaMinima']),
    `a configuração pública só tem campos públicos (${Object.keys(config).join(', ')})`
  );

  const semSessao = await fetch(`${url}/api/conta/eu`);
  check(semSessao.status === 401, 'sem crachá, /api/conta/eu responde 401');

  const tokenFalso = await fetch(`${url}/api/conta/eu`, {
    headers: { Authorization: 'Bearer inventado.123.abc' },
  });
  check(tokenFalso.status === 401, 'crachá inventado também é recusado');

  // ================================================== 2. a tela, ainda vazia
  const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const contexto = await navegador.newContext({ viewport: { width: 1366, height: 800 } });
  const pagina = await contexto.newPage();

  const erros = [];
  const doYoutube = (t) => /youtube|ytimg|iframe_api|ERR_TUNNEL/i.test(t);
  pagina.on('pageerror', (e) => !doYoutube(e.message) && erros.push(e.message));

  await pagina.goto(url);
  await espera(700);

  check(await pagina.locator('#tela-login').isVisible(), 'a tela de login aparece para quem não entrou');
  // O estado vazio precisa ser conferido AGORA, antes de qualquer partida.
  check(
    (await pagina.textContent('#ranking-lista')).includes('Nenhuma partida'),
    'sem partidas na semana, o painel explica em vez de ficar vazio'
  );
  check(
    !(await pagina.locator('#btn-criar').isEnabled().catch(() => false)) ||
      (await pagina.locator('#tela-login').isVisible()),
    'o menu do jogo fica atrás da tela de login'
  );

  // Os quatro modos existem e a tela troca entre eles.
  await pagina.click('.aba[data-modo="criar"]');
  check(await pagina.locator('#modo-criar').isVisible(), 'a aba "Criar conta" abre o formulário de cadastro');
  check(
    await pagina.locator('#novo-email').isVisible(),
    'e o e-mail é campo obrigatório do cadastro, na frente do apelido'
  );
  await pagina.click('.aba[data-modo="entrar"]');
  await pagina.click('#btn-esqueci');
  check(
    await pagina.locator('#modo-esqueci').isVisible(),
    'o botão "Esqueci minha senha" existe e abre a recuperação'
  );
  check(
    !(await pagina.locator('#esqueci-email').inputValue()) &&
      (await pagina.locator('#modo-esqueci').textContent()).toLowerCase().includes('apelido'),
    'a tela avisa que só o e-mail recupera — o apelido não'
  );
  await pagina.click('#btn-voltar-login');
  check(await pagina.locator('#modo-entrar').isVisible(), 'e o "Voltar" volta para o login');

  // ================================================== 3. o e-mail de confirmação
  const criada = await criarConta(url, 'Novato');
  const linkNovato = await esperarLink(emailDeTeste('Novato'), 'verificar');
  check(criada.usuario.verificado === false, 'a conta nova nasce SEM o e-mail confirmado');
  check(criada.usuario.email === emailDeTeste('Novato'), 'e guarda o e-mail que a pessoa digitou');
  check(caixa.quantos(emailDeTeste('Novato')) === 1, 'um e-mail de confirmação saiu na hora do cadastro');

  check(Boolean(linkNovato), `o e-mail traz o link de confirmação (${String(linkNovato).slice(0, 46)}…)`);

  // Link adulterado não confirma nada.
  check(
    (await abrirLink(`${url}/api/conta/verificar?t=token-inventado-por-mim`)) === '/?verificado=0',
    'um link inventado não confirma conta nenhuma'
  );
  const aindaNao = await fetch(`${url}/api/conta/eu`, {
    headers: { Authorization: `Bearer ${criada.token}` },
  }).then((r) => r.json());
  check(aindaNao.usuario.verificado === false, 'e a conta continua sem confirmação');

  // O link de verdade confirma.
  check((await abrirLink(linkNovato)) === '/?verificado=1', 'o link do e-mail confirma a conta');
  const agoraSim = await fetch(`${url}/api/conta/eu`, {
    headers: { Authorization: `Bearer ${criada.token}` },
  }).then((r) => r.json());
  check(agoraSim.usuario.verificado === true, 'e a conta passa a valer como confirmada');

  // Uso único: o mesmo link não serve duas vezes.
  check((await abrirLink(linkNovato)) === '/?verificado=0', 'o mesmo link não pode ser usado de novo');

  // Reenviar: existe, mas não é um megafone (um e-mail por minuto por endereço).
  const jaEra = await postar('reenviar', {}, criada.token);
  check(jaEra.ok && jaEra.jaVerificado === true, 'pedir reenvio de quem já confirmou não manda nada');

  const pendente = await criarConta(url, 'Pendente');
  await esperarLink(emailDeTeste('Pendente'), 'verificar');
  const reenvio = await postar('reenviar', {}, pendente.token);
  check(
    !reenvio.ok && /minuto/i.test(reenvio.erro || ''),
    `reenviar duas vezes seguidas é barrado: "${reenvio.erro}"`
  );
  check(caixa.quantos(emailDeTeste('Pendente')) === 1, 'e nenhum e-mail extra foi disparado');

  // Digitou o e-mail errado: dá para corrigir enquanto não confirmou.
  const trocado = await postar('trocar-email', { email: 'pendente-certo@exemplo.test' }, pendente.token);
  check(trocado.ok && trocado.usuario.email === 'pendente-certo@exemplo.test', 'dá para corrigir o e-mail digitado errado');
  await esperarLink('pendente-certo@exemplo.test', 'verificar');
  check(caixa.quantos('pendente-certo@exemplo.test') === 1, 'e o link novo vai para o endereço novo');
  const semSessaoTroca = await postar('trocar-email', { email: 'invadido@exemplo.test' });
  check(!semSessaoTroca.ok, 'trocar o e-mail sem crachá é recusado');

  // ================================================== 4. o ranking exige confirmação
  const sombra = await partidaCompleta(2, 'Sombra', { confirmar: false });
  check(sombra.final.fase === 'terminado', 'quem não confirmou joga normalmente');
  let tabela = await buscarRanking();
  check(
    sombra.contas.every((c) => !tabela.ranking.find((l) => l.id === c.id)),
    'mas não aparece no ranking enquanto não confirmar'
  );

  await abrirLink(await esperarLink(emailDeTeste('Sombra1'), 'verificar'));
  tabela = await buscarRanking();
  const apareceu = tabela.ranking.find((l) => l.id === sombra.contas[0].id);
  check(Boolean(apareceu), 'assim que confirma, a pontuação que já era dela aparece');
  check(apareceu && apareceu.partidas === 1, 'com a partida que ela já tinha jogado (nada foi perdido)');

  // ================================================== 5. recuperação de senha
  //
  // A TRAVA PRINCIPAL: saber o apelido de alguém não recupera nada. O apelido
  // está no ranking, à vista de todo mundo.
  const antesDoAtaque = caixa.quantos(emailDeTeste('Novato'));
  const soApelido = await postar('esqueci', { email: 'Novato' });
  check(soApelido.ok, 'pedir recuperação com um apelido responde normalmente...');
  await espera(80);
  check(
    caixa.quantos(emailDeTeste('Novato')) === antesDoAtaque,
    '...mas não manda e-mail nenhum: só o e-mail recupera'
  );

  // E-mail que não existe: MESMA resposta, para a rota não virar consultor de
  // "este endereço tem conta aqui?".
  const inexistente = await postar('esqueci', { email: 'ninguem@exemplo.test' });
  check(
    inexistente.ok && inexistente.mensagem === soApelido.mensagem,
    'e-mail sem conta responde exatamente a mesma coisa (não dá pra descobrir quem tem cadastro)'
  );

  // Agora o caminho honesto, do começo ao fim.
  const vitima = await criarConta(url, 'Esquecido');
  const emailVitima = emailDeTeste('Esquecido');
  const pedidoOk = await postar('esqueci', { email: emailVitima });
  check(pedidoOk.ok, 'com o e-mail certo, o pedido é aceito');

  const linkSenha = await esperarLink(emailVitima, 'redefinir');
  check(Boolean(linkSenha), `o link de nova senha chegou por e-mail (${String(linkSenha).slice(0, 40)}…)`);

  const tokenSenha = linkSenha.split('redefinir=').pop();
  const tipoErrado = await postar('redefinir', { token: caixa.token(emailVitima, 'verificar'), novaSenha: 'outra123' });
  check(!tipoErrado.ok, 'o link de confirmar e-mail NÃO serve para trocar senha');

  const redefiniu = await postar('redefinir', { token: tokenSenha, novaSenha: 'senha-nova-123' });
  check(redefiniu.ok && Boolean(redefiniu.token), 'com o link certo, a senha é redefinida e já entra na conta');
  check(redefiniu.usuario.verificado === true, 'e confirmar o e-mail vem de brinde: o link provou a caixa de entrada');

  const senhaVelha = await postar('entrar', { nome: 'Esquecido', senha: 'senha-de-teste' });
  check(!senhaVelha.ok, 'a senha antiga para de funcionar na hora');
  const senhaNova = await postar('entrar', { nome: 'Esquecido', senha: 'senha-nova-123' });
  check(senhaNova.ok, 'e a nova funciona');

  const repetido = await postar('redefinir', { token: tokenSenha, novaSenha: 'invadido-depois' });
  check(!repetido.ok, 'o link de recuperação não pode ser usado duas vezes');
  check((await postar('entrar', { nome: 'Esquecido', senha: 'senha-nova-123' })).ok, 'e a senha continua sendo a nova');
  check(Boolean(vitima.token), 'a conta usada no teste era mesmo uma conta de verdade');

  // ================================================== 6. login pela tela
  await entrarNoJogo(pagina, 'Victor');
  check(!(await pagina.locator('#tela-login').isVisible()), 'depois de criar a conta pela tela, entra no jogo');
  check((await pagina.textContent('#quem-sou')).trim() === 'Victor', 'a tela mostra quem está jogando');

  // A faixa de "confirme seu e-mail" aparece, sem travar o jogo.
  check(await pagina.locator('#faixa-email').isVisible(), 'a faixa pede a confirmação do e-mail');
  check(
    (await pagina.textContent('#email-pendente')).trim() === emailDeTeste('Victor'),
    'e mostra para qual endereço o link foi'
  );
  check(
    (await pagina.textContent('#faixa-email')).toLowerCase().includes('ranking'),
    'deixando claro o que está travado: o ranking, não o jogo'
  );
  check(await pagina.locator('#btn-criar').isEnabled(), 'quem não confirmou continua podendo criar sala e jogar');

  // Recarregar não pede login de novo: é a sessão fazendo o trabalho dela.
  await pagina.reload();
  await espera(1200);
  check(!(await pagina.locator('#tela-login').isVisible()), 'a sessão sobrevive ao F5');
  check((await pagina.textContent('#quem-sou')).trim() === 'Victor', 'e continua sendo a mesma conta');

  // Confirma o e-mail do Victor (como se ele clicasse no link em outra aba) e
  // volta para o jogo: a faixa tem que sumir sozinha.
  await abrirLink(await esperarLink(emailDeTeste('Victor'), 'verificar'));
  await pagina.evaluate(() => atualizarConta());
  await espera(400);
  check(!(await pagina.locator('#faixa-email').isVisible()), 'confirmou: a faixa some sem precisar recarregar');

  const denovo = await postar('entrar', { nome: 'Victor', senha: 'senha-de-teste' });
  check(denovo.ok, 'dá para entrar de novo na conta já criada');
  const peloEmail = await postar('entrar', { nome: emailDeTeste('Victor'), senha: 'senha-de-teste' });
  check(peloEmail.ok, 'e também pelo e-mail, no lugar do apelido');

  const eu = await fetch(`${url}/api/conta/eu`, {
    headers: { Authorization: `Bearer ${denovo.token}` },
  }).then((r) => r.json());
  check(eu.ok && eu.usuario.nome === 'Victor', 'o crachá identifica a conta certa');

  // ================================================== 7. o painel do ranking
  check(await pagina.locator('#ranking').isVisible(), 'o painel do ranking aparece na tela principal');
  const lugar = await pagina.evaluate(() => {
    const r = document.querySelector('#ranking').getBoundingClientRect();
    const p = document.querySelector('#tela-entrada .painel').getBoundingClientRect();
    return { rankingAEsquerda: r.left > p.right, dentroDaTela: r.right <= innerWidth + 1 };
  });
  check(lugar.rankingAEsquerda, 'o ranking fica à direita, sem cobrir o painel do jogo');
  check(lugar.dentroDaTela, 'e cabe na tela');

  // ============================== 8, 9, 10. as mesas de 2, 3 e 4
  //
  // O placar de uma partida real depende do baralho, então não dá para fixar
  // "5, 3, 2, 1" na marra: uma mesa pode terminar empatada, e a regra manda os
  // empatados dividirem a posição (dois primeiros levam 5 cada, e o próximo é
  // o 3º lugar). Em vez de chutar, conferimos o que o RANKING gravou contra a
  // classificação que a partida realmente produziu.
  async function conferirMesa(quantos, prefixo) {
    const partida = await partidaCompleta(quantos, prefixo);
    check(partida.final.fase === 'terminado', `a partida de ${quantos} jogadores terminou`);

    const classificados = posicionar(partida.final.resultado.tabela);
    const esperado = new Map(
      classificados.map((l) => [l.id, pontosDaPosicao(l.posicao, quantos)])
    );

    tabela = await buscarRanking();
    const conferidos = partida.contas.map((c) => {
      const linha = tabela.ranking.find((l) => l.id === c.id);
      return { nome: c.nomeDeTeste, obtido: linha ? linha.pontos : null, esperado: esperado.get(c.id) };
    });

    const houveEmpate = classificados.length !== new Set(classificados.map((l) => l.posicao)).size;
    check(
      conferidos.every((c) => c.obtido === c.esperado),
      `mesa de ${quantos}: cada um levou os pontos da sua posição` +
        `${houveEmpate ? ' (com empate, dividindo a posição)' : ''} — ` +
        conferidos.map((c) => `${c.nome}: ${c.obtido}`).join(', ')
    );
    return conferidos;
  }

  const dupla = await conferirMesa(2, 'Dupla');
  check(
    dupla.map((c) => c.esperado).sort().join() === '0,1' ||
      dupla.map((c) => c.esperado).join() === '1,1',
    `mesa de 2 usa a tabela [1, 0] (foi ${dupla.map((c) => c.obtido).join(' e ')})`
  );

  const trio = await conferirMesa(3, 'Trio');
  check(
    trio.every((c) => [0, 1, 2].includes(c.obtido)),
    `mesa de 3 usa a tabela [2, 1, 0] (foi ${trio.map((c) => c.obtido).join(', ')})`
  );

  const quarteto = await conferirMesa(4, 'Quarteto');
  check(
    quarteto.every((c) => [0, 1, 2, 3, 5].includes(c.obtido)),
    `mesa de 4 usa a tabela [5, 3, 2, 1] (foi ${quarteto.map((c) => c.obtido).join(', ')})`
  );

  // ================================================== 11. atualiza sozinho
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

  // ================================================== 12. virada de semana
  // A semana passada tem que continuar consultável, e a atual não pode herdar
  // ponto nenhum dela.
  const semanas = await fetch(`${url}/api/ranking/semanas`).then((r) => r.json());
  check(semanas.ok && semanas.semanas.length >= 1, 'o histórico de semanas existe');

  const outraSemana = await fetch(`${url}/api/ranking?semana=1999-S01`).then((r) => r.json());
  check(outraSemana.ok && outraSemana.ranking.length === 0, 'uma semana sem partidas vem vazia');
  check(tabela.ranking.length > 0, 'enquanto a semana atual continua com os pontos desta semana');

  // ================================================== 13. logout
  await pagina.click('#btn-sair-conta');
  await espera(500);
  check(await pagina.locator('#tela-login').isVisible(), 'o logout leva de volta para a tela de login');
  await pagina.reload();
  await espera(1200);
  check(
    await pagina.locator('#tela-login').isVisible(),
    'e depois do logout o F5 não entra de novo sozinho'
  );

  // ============================== 14. a recuperação inteira, pela tela
  // Do "esqueci minha senha" até estar dentro do jogo com a senha nova, sem
  // sair do navegador uma vez.
  await criarConta(url, 'Perdido');
  const emailPerdido = emailDeTeste('Perdido');

  await pagina.click('#btn-esqueci');
  await pagina.fill('#esqueci-email', emailPerdido);
  await pagina.click('#btn-enviar-recuperacao');
  await espera(600);
  check(await pagina.locator('#esqueci-ok').isVisible(), 'a tela confirma o pedido de recuperação');
  check(
    !(await pagina.textContent('#esqueci-ok')).includes(emailPerdido),
    'sem repetir o endereço na tela — quem estiver olhando não descobre nada'
  );

  const linkPerdido = await esperarLink(emailPerdido, 'redefinir');
  check(Boolean(linkPerdido), 'e o link chegou');

  await pagina.goto(linkPerdido);
  await espera(900);
  check(await pagina.locator('#modo-redefinir').isVisible(), 'abrir o link mostra a tela de nova senha');

  await pagina.fill('#senha-nova', 'outra-senha-456');
  await pagina.click('#btn-salvar-senha');
  await pagina.waitForSelector('#tela-login', { state: 'hidden', timeout: 10000 });
  check((await pagina.textContent('#quem-sou')).trim() === 'Perdido', 'salvou a senha nova e entrou direto');
  check(
    !(await pagina.evaluate(() => location.search)).includes('redefinir'),
    'e o token some do endereço — não fica no histórico do navegador'
  );
  check(
    (await postar('entrar', { nome: 'Perdido', senha: 'outra-senha-456' })).ok &&
      !(await postar('entrar', { nome: 'Perdido', senha: 'senha-de-teste' })).ok,
    'a senha nova vale e a antiga morreu'
  );

  check(erros.length === 0, `nenhum erro de JavaScript ${erros.length ? JSON.stringify(erros.slice(0, 3)) : ''}`);
  await navegador.close();

  // ============================== 15. o freio de tentativas (por último)
  // Este teste TRANCA o IP de propósito, então fica no fim: nada depois dele
  // depende de conseguir entrar.
  let travou = false;
  for (let i = 0; i < 14; i++) {
    const r = await postar('entrar', { nome: 'NaoExiste', senha: 'chute' });
    if (/Muitas tentativas/.test(r.erro || '')) { travou = true; break; }
  }
  check(travou, 'o freio bloqueia quem fica chutando senha');

  servidor.kill();
  process.exit(falhas ? 1 : 0);
})().catch((e) => {
  console.error('EXPLODIU:', e);
  servidor.kill();
  process.exit(1);
});
