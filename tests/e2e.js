// Teste ponta a ponta: sobe o servidor de verdade e simula 2 jogadores por Socket.IO.
//
// Rode com:  npm run test:e2e
// (precisa de socket.io-client, que esta em devDependencies - rode npm install antes)
//
// Diferente de npm test, que testa as regras em memoria, este aqui testa o caminho
// completo: navegador -> socket -> handlers -> motor -> volta pros dois jogadores.
const { io } = require('socket.io-client');
const { spawn } = require('child_process');
const { jogador, ambienteDeTeste, capturarEmails, confirmarEmail } = require('./ajuda');

const PORTA = 3999;
const url = `http://localhost:${PORTA}`;
const raiz = require('path').join(__dirname, '..');
const servidor = spawn('node', ['server/index.js'], { cwd: raiz, env: ambienteDeTeste(PORTA) });
const caixa = capturarEmails(servidor);

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const pedir = (sock, ev, dados) => new Promise((r) => sock.emit(ev, dados, r));
const esperarEvento = (sock, ev) => new Promise((r) => sock.once(ev, r));

function check(cond, msg) {
  console.log(`${cond ? 'ok   ' : 'FALHA'}  ${msg}`);
  if (!cond) process.exitCode = 1;
}

(async () => {
  await espera(1200);
  // Cada jogador agora precisa de conta: o socket so conecta com um cracha
  // valido. Os ids abaixo sao os ids DAS CONTAS, nao mais nomes inventados.
  const contaAna = await jogador(url, 'Ana');
  const contaBruno = await jogador(url, 'Bruno');
  const contaEstranho = await jogador(url, 'Estranho');
  const ana = contaAna.socket, bruno = contaBruno.socket, estranho = contaEstranho.socket;
  const ID_ANA = contaAna.id, ID_BRUNO = contaBruno.id;

  // Um socket sem cracha nao entra de jeito nenhum.
  const semConta = io(url, { auth: {} });
  const recusa = await new Promise((r) => {
    semConta.once('connect_error', (e) => r(e.message));
    semConta.once('connect', () => r('conectou!'));
  });
  check(recusa === 'nao-autenticado', `socket sem conta e recusado ("${recusa}")`);
  semConta.close();

  // 1. Ana cria a sala
  const criada = await pedir(ana, 'criar-sala', {});
  check(criada.ok && /^[A-Z0-9]{4}$/.test(criada.sala.codigo), `Ana criou a sala ${criada.sala?.codigo}`);
  const codigo = criada.sala.codigo;

  // 2. Bruno entra e Ana é avisada em tempo real
  const avisoParaAna = esperarEvento(ana, 'sala-atualizada');
  const entrou = await pedir(bruno, 'entrar-sala', { codigo });
  check(entrou.ok, 'Bruno entrou na sala');
  const salaVistaPelaAna = await avisoParaAna;
  check(salaVistaPelaAna.jogadores.length === 2, 'Ana recebeu o aviso de que Bruno chegou');
  check(salaVistaPelaAna.jogadores.map(j => j.cor).join() === 'vermelho,azul', 'cores diferentes atribuídas');

  // 3. Código errado
  const errado = await pedir(estranho, 'entrar-sala', { codigo: 'XXXX' });
  check(!errado.ok && /não encontrada/.test(errado.erro), `código errado recusado: "${errado.erro}"`);

  // 4. Quem não é anfitrião não começa
  const tentativa = await pedir(bruno, 'iniciar-partida', {});
  check(!tentativa.ok && /Só quem criou/.test(tentativa.erro), `Bruno não pode começar: "${tentativa.erro}"`);

  // 5. Ana começa: os dois recebem o estado
  const estadoAna = esperarEvento(ana, 'estado-atualizado');
  const estadoBruno = esperarEvento(bruno, 'estado-atualizado');
  const iniciou = await pedir(ana, 'iniciar-partida', {});
  check(iniciou.ok, 'Ana começou a partida');
  const [eA, eB] = [await estadoAna, await estadoBruno];
  check(eA.jogadores.find(j => j.id === ID_ANA).mao.length === 4, 'Ana recebeu 4 cartas');
  check(eA.jogadores.find(j => j.id === ID_BRUNO).mao === undefined, 'Ana NÃO vê a mão do Bruno');
  check(eB.jogadores.find(j => j.id === ID_ANA).mao === undefined, 'Bruno NÃO vê a mão da Ana');
  check(eA.vezDe === ID_ANA, 'a vez é da Ana');

  // 6. Quem chega com a partida em andamento entra como espectador
  const espectadorEstado = esperarEvento(estranho, 'estado-atualizado');
  const atrasado = await pedir(estranho, 'entrar-sala', { codigo });
  check(atrasado.ok && atrasado.sala.espectadores.length === 1, 'quem chega tarde vira espectador');
  const visaoDoEspectador = await espectadorEstado;
  check(visaoDoEspectador.espectador === true, 'o espectador recebe o estado marcado como tal');
  check(visaoDoEspectador.jogadores.every((j) => j.mao === undefined), 'e sem a mão de ninguém');

  const proibido = await pedir(estranho, 'jogar-carta', {
    uid: eA.jogadores.find((j) => j.id === ID_ANA).mao[0].uid,
  });
  check(!proibido.ok && /assistindo/.test(proibido.erro),
    `espectador não consegue jogar: "${proibido.erro}"`);

  // 7. Uma jogada real, fora da vez e na vez
  const foraDaVez = await pedir(bruno, 'jogar-carta', { uid: eB.jogadores.find(j => j.id === ID_BRUNO).mao[0].uid });
  check(!foraDaVez.ok && /vez/.test(foraDaVez.erro), `jogada fora da vez recusada: "${foraDaVez.erro}"`);

  const proximoEstado = esperarEvento(bruno, 'estado-atualizado');
  const carta = eA.jogadores.find(j => j.id === ID_ANA).mao.find(c => !['tucano','coelho','polvo'].includes(c.animal));
  const jogou = await pedir(ana, 'jogar-carta', { uid: carta.uid });
  check(jogou.ok, `Ana jogou ${carta.animal}`);
  const depois = await proximoEstado;
  check(depois.fila.length === 1 && depois.fila[0].animal === carta.animal, 'a carta apareceu na fila dos dois');
  check(depois.vezDe === ID_BRUNO, 'a vez passou para o Bruno');

  // 8. Reconexão: Ana cai e volta
  ana.disconnect();
  await espera(300);
  const ana2 = io(url, { auth: { token: contaAna.token } });
  await espera(300);
  const volta = await pedir(ana2, 'entrar-sala', { codigo });
  check(volta.ok && volta.sala.jogadores.length === 2, 'Ana reconectou e a partida continua');

  // 9. A página é servida
  const html = await fetch(url).then(r => r.text());
  check(html.includes('Bar Bestial'), 'a página inicial é servida');
  const api = await fetch(`${url}/api/animais`).then(r => r.json());
  check(api.animais.length === 12, 'a API entrega os 12 animais para o cliente');

  [bruno, estranho, ana2].forEach(s => s.disconnect());

  // ---------------------------------------------------------------------
  // PARTE 2: uma partida inteira, do inicio ao fim, so por socket.
  // Simula exatamente o que main.js faz quando o jogador clica numa carta,
  // inclusive as escolhas do tucano, do coelho e do polvo.
  // ---------------------------------------------------------------------
  console.log('');
  const um = await jogador(url, 'Umzinho');
  const dois = await jogador(url, 'Doisinho');
  const p1 = um.socket, p2 = dois.socket;
  await espera(400);

  const estados = { p1: null, p2: null };
  p1.on('estado-atualizado', (e) => { estados.p1 = e; });
  p2.on('estado-atualizado', (e) => { estados.p2 = e; });

  const nova = await pedir(p1, 'criar-sala', {});
  await pedir(p2, 'entrar-sala', { codigo: nova.sala.codigo });
  await pedir(p1, 'iniciar-partida', {});
  await espera(300);

  // Copia da logica do cliente: monta a escolha que a carta exige.
  function escolhaPara(carta, estado) {
    const catalogo = { tucano: 'animal', coelho: 'pular1ou2', polvo: 'especie' };
    const tipo = catalogo[carta.animal];
    if (!tipo || estado.fila.length === 0) return null;
    if (tipo === 'animal') return { alvoUid: estado.fila[0].uid };
    if (tipo === 'pular1ou2') return { pulos: 1 };
    const especies = [...new Set(estado.fila.map((c) => c.animal))].filter((e) => e !== 'polvo');
    if (especies.length === 0) return null;
    const dados = { especie: especies[0] };
    if (especies[0] === 'tucano') dados.alvoUid = estado.fila[0].uid;
    if (especies[0] === 'coelho') dados.pulos = 1;
    return dados;
  }

  let rodadas = 0;
  let erroNaPartida = null;
  while (rodadas < 40) {
    const estado = estados.p1;
    if (!estado || estado.fase === 'terminado') break;
    const quem = estado.vezDe === um.id ? p1 : p2;
    const visao = estado.vezDe === um.id ? estados.p1 : estados.p2;
    const mao = visao.jogadores.find((j) => j.id === estado.vezDe).mao;
    const carta = mao[Math.floor(rodadas * 7 % mao.length)]; // varia a carta escolhida
    const r = await pedir(quem, 'jogar-carta', { uid: carta.uid, escolha: escolhaPara(carta, visao) });
    if (!r.ok) { erroNaPartida = `${carta.animal}: ${r.erro}`; break; }
    await espera(25);
    rodadas++;
  }

  check(!erroNaPartida, `24 jogadas sem nenhuma recusa ${erroNaPartida ? '-> ' + erroNaPartida : ''}`);
  check(rodadas === 24, `a partida durou exatamente 24 jogadas (foram ${rodadas})`);
  const final = estados.p1;
  check(final.fase === 'terminado', 'a partida terminou sozinha');
  const total = final.bar.length + final.ralo.length + final.fila.length;
  check(total === 24, `todas as 24 cartas estao no bar, no ralo ou na fila (${total})`);
  check(Array.isArray(final.vencedores) && final.vencedores.length >= 1,
    `vencedor anunciado: ${(final.vencedores || []).map(v => v.nome).join(', ')}`);
  check(final.placar.reduce((s, p) => s + p.entraram, 0) === final.bar.length,
    'o placar bate com o numero de animais dentro do bar');

  // ---------------------------------------------------------------------
  // PARTE 3: a partida que acabou de terminar virou pontos no ranking.
  // ---------------------------------------------------------------------
  console.log('');
  await espera(400); // o servidor grava logo depois de avisar o estado

  // O ranking so mostra quem confirmou o e-mail. Os dois clicam no link.
  for (const nome of ['Umzinho', 'Doisinho']) await confirmarEmail(caixa, nome);

  const tabela = await fetch(`${url}/api/ranking`).then((r) => r.json());
  const linhaUm = tabela.ranking.find((l) => l.id === um.id);
  const linhaDois = tabela.ranking.find((l) => l.id === dois.id);
  check(linhaUm && linhaDois, 'os dois jogadores aparecem no ranking da semana');
  check(
    (linhaUm.pontos + linhaDois.pontos) >= 1,
    `mesa de 2 distribuiu pontos (${linhaUm.pontos} e ${linhaDois.pontos})`
  );
  check(linhaUm.partidas === 1 && linhaDois.partidas === 1, 'cada um com exatamente 1 partida');
  check(
    tabela.semana && /^\d{4}-S\d{2}$/.test(tabela.semana.chave),
    `a semana atual e ${tabela.semana?.chave}`
  );

  // Reconectar e receber o estado terminado de novo NAO pode contar outra vez.
  const voltou = io(url, { auth: { token: um.token } });
  await espera(300);
  await pedir(voltou, 'entrar-sala', { codigo: nova.sala.codigo });
  await espera(500);
  const depoisDaVolta = await fetch(`${url}/api/ranking`).then((r) => r.json());
  const agora = depoisDaVolta.ranking.find((l) => l.id === um.id);
  check(agora.partidas === 1, 'reconectar depois do fim nao conta a partida de novo');
  voltou.disconnect();

  [p1, p2].forEach(s => s.disconnect());
  servidor.kill();
  await espera(200);
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error('EXPLODIU:', e); servidor.kill(); process.exit(1); });

