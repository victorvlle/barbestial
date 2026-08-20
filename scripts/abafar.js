// "A FESTA DO OUTRO LADO DA PAREDE"
//
// Este script pega os arquivos de música originais e devolve as versões que o
// jogo toca: abafadas, distantes, como se a festa estivesse acontecendo na sala
// ao lado e você estivesse do lado de fora.
//
// COMO USAR
//   1. coloque os originais em audio-original/<festa>/ - com QUALQUER nome
//   2. rode:  node scripts/abafar.js
//   3. os tratados aparecem em public/assets/festas/<festa>/, prontos
//
// O nome do arquivo é o que vai aparecer no tocador, no formato
// "Título - Artista.mp3". Não precisa renomear nada se já estiver assim.
//
//   node scripts/abafar.js --forcar    refaz até os que já existem
//   node scripts/abafar.js edm         trata só uma festa
//
// PRECISA DO FFMPEG. No Windows: https://www.gyan.dev/ffmpeg/builds/ (baixe o
// "release essentials", descompacte e ponha a pasta bin no PATH).
//
// POR QUE PROCESSAR ANTES, E NÃO NO NAVEGADOR: fazer isso ao vivo com Web Audio
// custa processamento em toda máquina que abrir o jogo, muda de resultado entre
// navegadores, e ainda obrigaria a baixar o arquivo original inteiro - maior e
// mais caro. Tratado uma vez, o jogo só toca.
//
// ============================ A CADEIA DE EFEITOS ============================
// Cada etapa existe por um motivo. A ordem importa.
//
//   highpass f=40      tira o sub-grave que só faria o alto-falante bater sem
//                      virar som; parede nenhuma deixa isso passar limpo
//   lowpass f=500 (x2) O CORAÇÃO DO EFEITO. Duas passadas = queda mais íngreme.
//                      Acima de ~500 Hz quase nada atravessa uma parede: é por
//                      isso que do lado de fora você ouve o beat e o baixo, mas
//                      não o chimbal nem o "s" do vocal
//   equalizer 90 Hz +3 devolve um pouco do corpo do grave, que a parede
//                      transmite bem (por isso o vizinho reclama do bumbo)
//   equalizer 300 Hz -3 tira o "abafado de cobertor", aquele acúmulo chato de
//                      médio-grave, sem devolver a clareza
//   asoftclip atan     saturação suave: o som passando por material e por um
//                      sistema empurrado no talo distorce um pouquinho
//   aecho              reverberação curta e discreta - o corredor entre você e
//                      a pista. Dois ecos bem baixos, não uma igreja
//   acompressor        aperta a dinâmica: de longe, a diferença entre o alto e
//                      o baixo da música some
//   loudnorm           normaliza TODAS as faixas no mesmo volume percebido
//                      (-14 LUFS, o alvo do streaming), para nenhuma música
//                      pular no meio da partida e para a festa não ficar baixa
//
// Nada de som de gente, copo, risada ou porta: é só a música, tratada.

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const executar = promisify(execFile);

const raiz = path.join(__dirname, '..');
const ORIGINAIS = path.join(raiz, 'audio-original');
const DESTINO = path.join(raiz, 'public', 'assets', 'festas');

const { FESTAS, FORMATOS } = require('../server/game/festas');

// A cadeia até antes da normalização. O volume é resolvido depois, em duas
// passadas (ver tratar), porque numa passada só o ffmpeg estima o volume no
// escuro e deixa a faixa estourar acima do máximo - o que vira estalo.
const PAREDE = [
  'highpass=f=40',
  'lowpass=f=500',
  'lowpass=f=500',
  'equalizer=f=90:t=q:w=1:g=3',
  'equalizer=f=300:t=q:w=1.2:g=-3',
  'asoftclip=type=atan:threshold=0.7',
  'aecho=0.8:0.7:28|45:0.18|0.11',
  'acompressor=threshold=-18dB:ratio=4:attack=25:release=250',
].join(',');

// -14 LUFS: o mesmo alvo do streaming. O corte de agudos já derruba muito a
// energia percebida, e normalizar em -23 (o padrão de broadcast) deixava a
// festa baixa demais - dava vontade de subir o volume do computador inteiro.
const ALVO = { I: -14, TP: -2, LRA: 9 };

// Uma trava no fim da fila, para o mp3 não estourar na hora de decodificar.
//
// 0.65 (~-3.7 dBFS), e não 0.9 como era antes. O alimiter trava a AMOSTRA, mas
// quem estoura o alto-falante é o PICO REAL, que o decodificador reconstrói
// ENTRE duas amostras. E o mp3 de 96 kbps depois do corte de agudos exagera
// nisso: medido aqui, uma faixa travada em -2.0 dB de amostra saiu do
// decodificador com +0.56 dBTP - dois decibéis e meio de sobra, acima do
// máximo, ou seja, estalo nos picos.
//
// A escada medida nessa mesma faixa:
//   limit=0.85 -> -2.0 dB de amostra -> +0.56 dBTP  (estoura)
//   limit=0.75 -> -2.5 dB            -> +0.06 dBTP  (no fio)
//   limit=0.70 -> -3.1 dB            -> -0.54 dBTP
//   limit=0.65 -> -3.7 dB            -> -1.18 dBTP  <- com folga
// E o volume percebido quase não muda (-14.41 -> -14.55 LUFS): o limitador só
// encosta nos picos, e é o corpo da música que manda no LUFS. Ou seja, a folga
// sai de graça.
const TRAVA = 'alimiter=limit=0.65:level=false';

// Mono e 96 kbps de propósito: depois do corte de agudos não sobra informação
// nenhuma acima de 500 Hz para guardar, e o arquivo fica pequeno - o que
// importa num servidor gratuito e para quem abre o jogo pelo celular.
const SAIDA = ['-ac', '1', '-ar', '44100', '-b:a', '96k'];

async function temFfmpeg() {
  try {
    await executar('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}

// DUAS PASSADAS.
//
// A primeira só MEDE o volume da faixa já com o efeito aplicado; a segunda
// normaliza usando essas medidas. É a diferença entre o ffmpeg adivinhar
// enquanto toca (e errar para cima, estourando o pico) e ele saber de antemão.
// Custa o dobro do tempo e roda uma vez só na vida de cada música.
async function medir(entrada) {
  const filtro = `${PAREDE},loudnorm=I=${ALVO.I}:TP=${ALVO.TP}:LRA=${ALVO.LRA}:print_format=json`;
  const { stderr } = await executar(
    'ffmpeg',
    ['-i', entrada, '-af', filtro, '-f', 'null', '-'],
    { maxBuffer: 1024 * 1024 * 32 }
  );
  // O JSON sai no fim do relatório do ffmpeg.
  const json = stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1);
  return JSON.parse(json);
}

async function tratar(entrada, saida) {
  await fs.promises.mkdir(path.dirname(saida), { recursive: true });

  const m = await medir(entrada);
  const normalizar =
    `loudnorm=I=${ALVO.I}:TP=${ALVO.TP}:LRA=${ALVO.LRA}` +
    `:measured_I=${m.input_i}:measured_TP=${m.input_tp}` +
    `:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}` +
    `:offset=${m.target_offset}:linear=true`;

  await executar(
    'ffmpeg',
    ['-y', '-i', entrada, '-af', [PAREDE, normalizar, TRAVA].join(','), ...SAIDA, saida],
    { maxBuffer: 1024 * 1024 * 32 }
  );
}

async function principal() {
  const argumentos = process.argv.slice(2);
  const forcar = argumentos.includes('--forcar');
  const soEsta = argumentos.find((a) => !a.startsWith('--'));

  if (!(await temFfmpeg())) {
    console.error('\n  Não achei o ffmpeg. Ele é quem faz o tratamento do áudio.');
    console.error('  Windows: baixe em https://www.gyan.dev/ffmpeg/builds/ e ponha a pasta bin no PATH.\n');
    process.exit(1);
  }

  let tratadas = 0;
  let puladas = 0;

  for (const festa of FESTAS) {
    if (soEsta && festa.id !== soEsta) continue;

    const pastaEntrada = path.join(ORIGINAIS, festa.id);
    console.log(`\n${festa.emoji}  ${festa.nome}`);

    if (!fs.existsSync(pastaEntrada)) {
      console.log(`  nada em audio-original/${festa.id}/`);
      continue;
    }

    const arquivos = fs
      .readdirSync(pastaEntrada)
      .filter((nome) => FORMATOS.includes(path.extname(nome).toLowerCase()));

    if (!arquivos.length) {
      console.log(`  nada em audio-original/${festa.id}/`);
      continue;
    }

    for (const arquivo of arquivos) {
      // O tratado sai sempre em .mp3, com o mesmo nome do original: é esse nome
      // que vira "Artista — Título" no tocador.
      const saida = path.join(DESTINO, festa.id, arquivo.replace(/\.[^.]+$/, '.mp3'));

      if (fs.existsSync(saida) && !forcar) {
        console.log(`  já tratada  ${arquivo}`);
        puladas++;
        continue;
      }

      process.stdout.write(`  tratando    ${arquivo}...`);
      await tratar(path.join(pastaEntrada, arquivo), saida);
      const tamanho = (fs.statSync(saida).size / 1024 / 1024).toFixed(1);
      console.log(` pronto (${tamanho} MB)`);
      tratadas++;
    }
  }

  console.log(`\n  ${tratadas} tratada(s), ${puladas} já estavam prontas.`);
  console.log('  Rode `npm run musicas` para ver como ficou a playlist.\n');
}

principal().catch((erro) => {
  console.error('\n  Deu errado:', erro.message, '\n');
  process.exit(1);
});
