// O relógio do turno: se o jogador não joga, o servidor joga por ele.
// Roda com um limite curto (variável LIMITE_TURNO_MS) para não esperar 35s.
const { io } = require('socket.io-client');
const { spawn } = require('child_process');
const path = require('path');

const PORTA = 3985;
const LIMITE = 3000;
const url = `http://localhost:${PORTA}`;
const servidor = spawn('node', ['server/index.js'], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, PORT: PORTA, LIMITE_TURNO_MS: String(LIMITE) },
});
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const pedir = (s, ev, d) => new Promise((r) => s.emit(ev, d, r));
let falhas = 0;
const check = (c, m) => { console.log(`${c ? 'ok   ' : 'FALHA'}  ${m}`); if (!c) falhas++; };

(async () => {
  await espera(1500);
  const ana = io(url), bruno = io(url);
  await espera(400);

  const estados = {};
  ana.on('estado-atualizado', (e) => { estados.ana = e; });
  bruno.on('estado-atualizado', (e) => { estados.bruno = e; });

  const sala = await pedir(ana, 'criar-sala', { jogadorId: 'ana', nome: 'Ana' });
  await pedir(bruno, 'entrar-sala', { codigo: sala.sala.codigo, jogadorId: 'bruno', nome: 'Bruno' });
  await pedir(ana, 'iniciar-partida', {});
  await espera(300);

  check(estados.ana.turno.limiteMs === LIMITE, `o limite do turno chega ao cliente (${estados.ana.turno.limiteMs}ms)`);
  check(estados.ana.turno.restanteMs > 0, `com o tempo restante (${estados.ana.turno.restanteMs}ms)`);
  const vezInicial = estados.ana.vezDe;
  const filaInicial = estados.ana.fila.length;

  // ninguém joga: o servidor precisa jogar sozinho
  await espera(LIMITE + 1200);

  check(estados.ana.fila.length > filaInicial || estados.ana.bar.length > 0,
    `passou o tempo e uma carta foi jogada sozinha (fila ${filaInicial} → ${estados.ana.fila.length})`);
  check(estados.ana.vezDe !== vezInicial, 'e a vez passou para o próximo');
  const avisou = estados.ana.log.some((l) => l.partes.some((p) => /Tempo esgotado/.test(p.t)));
  check(avisou, 'o registro conta que o tempo acabou');

  // segue sozinho: mais um turno automático
  const jogadasAntes = estados.ana.jogadas;
  await espera(LIMITE + 1200);
  check(estados.ana.jogadas > jogadasAntes, 'e continua jogando sozinho no turno seguinte');

  // quem joga a tempo reinicia o relógio
  const daVez = estados.ana.vezDe === 'ana' ? ana : bruno;
  const visao = estados.ana.vezDe === 'ana' ? estados.ana : estados.bruno;
  const mao = visao.jogadores.find((j) => j.id === visao.vezDe).mao;
  if (mao && mao.length) {
    const antes = estados.ana.turno.restanteMs;
    await pedir(daVez, 'jogar-carta', { uid: mao[0].uid, escolha: { pulos: 1, alvoUid: visao.fila[0]?.uid, especie: visao.fila[0]?.animal } });
    await espera(200);
    check(estados.ana.turno.restanteMs >= antes - 300, 'jogar reinicia o relógio do turno');
  }

  ana.disconnect(); bruno.disconnect();
  servidor.kill();
  await espera(200);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('EXPLODIU:', e); servidor.kill(); process.exit(1); });
