// Painel de administração: ver quem se cadastrou e o que andou acontecendo.
//
// TRÊS TRAVAS DE SEGURANÇA, porque isto fica exposto na internet:
//
//   1. SEM ADMIN_SEGREDO CONFIGURADO, A ROTA NÃO EXISTE. Não é "senha vazia
//      permite tudo": o roteador simplesmente não é montado, e /admin responde
//      404 como qualquer endereço inventado. Esquecer de configurar deixa o
//      painel fechado, nunca aberto.
//   2. A comparação da senha é em tempo constante. Comparar com === vazaria,
//      pelo tempo de resposta, quantos caracteres iniciais estavam certos.
//   3. Um freio de tentativas por IP, para transformar "milhões de chutes por
//      minuto" em "alguns".
//
// E o que este painel NUNCA devolve: senha_hash e senha_sal. Nem para o
// administrador. Não há como LER a senha de ninguém - ela não está guardada em
// lugar nenhum (ver server/dados/usuarios.js).
//
// O que ele PODE fazer é DEFINIR uma senha nova para alguém que esqueceu a
// dela. É a recuperação de conta deste jogo: a pessoa avisa, o administrador
// define uma senha nova e entrega. Ler e escrever são coisas diferentes, e só a
// segunda é necessária para resolver o problema de quem esqueceu.

const path = require('path');
const crypto = require('crypto');
const express = require('express');

const banco = require('../dados/banco');
const ranking = require('../dados/ranking');
const usuarios = require('../dados/usuarios');

const SEGREDO = process.env.ADMIN_SEGREDO || '';
const ligado = () => Boolean(SEGREDO);

const router = express.Router();

// ------------------------------------------------------ freio de tentativas
const TENTATIVAS_MAXIMAS = 10;
const JANELA_MS = 60 * 1000;
const tentativas = new Map();

function excedeu(ip) {
  const agora = Date.now();
  const registro = tentativas.get(ip);
  if (!registro || registro.ate < agora) {
    tentativas.set(ip, { contagem: 1, ate: agora + JANELA_MS });
    return false;
  }
  registro.contagem += 1;
  return registro.contagem > TENTATIVAS_MAXIMAS;
}

function segredoConfere(recebido) {
  const a = Buffer.from(String(recebido || ''), 'utf8');
  const b = Buffer.from(SEGREDO, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Porteiro de todas as rotas de dados abaixo.
//
// Repare na ordem: a senha e conferida ANTES do freio. So tentativa ERRADA
// conta. Se o freio viesse primeiro, o painel abrindo sozinho a cada 15
// segundos gastaria a cota e acabaria bloqueando o proprio administrador -
// o freio existe para quem chuta senha, nao para quem ja acertou.
function sóAdministrador(req, res, proximo) {
  const cabecalho = String(req.headers.authorization || '');
  const enviado = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : '';

  if (segredoConfere(enviado)) {
    tentativas.delete(req.ip); // acertou: a contagem de erros recomeca
    return proximo();
  }

  if (excedeu(req.ip)) return res.status(429).json({ ok: false, erro: 'Muitas tentativas. Espere um minuto.' });
  return res.status(401).json({ ok: false, erro: 'Senha incorreta.' });
}

// ------------------------------------------------------------------ rotas

// A página em si não traz dado nenhum: é só o formulário. Os dados só chegam
// depois, pela rota protegida abaixo.
router.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

router.get('/api/admin/dados', sóAdministrador, async (req, res) => {
  try {
    const semana = req.query.semana ? String(req.query.semana) : ranking.chaveDaSemana();

    // Repare nas colunas: nem senha_hash nem senha_sal aparecem na consulta.
    const contas = await banco.tudo(
      `SELECT u.id, u.apelido AS nome, u.email, u.email_verificado_em, u.criado_em, u.visto_em, u.senha_trocada_em,
              (SELECT COUNT(*) FROM resultados r WHERE r.usuario_id = u.id) AS partidas,
              (SELECT COALESCE(SUM(r.pontos), 0) FROM resultados r WHERE r.usuario_id = u.id) AS pontosTotais
         FROM usuarios u
        ORDER BY u.criado_em DESC`
    );

    const partidas = await banco.tudo(
      `SELECT p.id, p.sala, p.terminou_em, p.semana, p.jogadores,
              (SELECT GROUP_CONCAT(u.apelido || ' (' || r.posicao || 'º, ' || r.pontos || 'pt)', ', ')
                 FROM resultados r JOIN usuarios u ON u.id = r.usuario_id
                WHERE r.partida_id = p.id
                ORDER BY r.posicao) AS quem
         FROM partidas p
        ORDER BY p.terminou_em DESC
        LIMIT 30`
    );

    const totalDePartidas = await banco.um('SELECT COUNT(*) AS n FROM partidas');

    res.json({
      ok: true,
      agora: Date.now(),
      semana: ranking.semanaAtual(),
      semanaConsultada: semana,
      contas,
      ranking: await ranking.rankingDaSemana(semana),
      partidas,
      totais: {
        contas: contas.length,
        partidas: totalDePartidas.n,
        semanas: await ranking.semanasComPartidas(),
      },
    });
  } catch (erro) {
    console.error('[admin]', erro);
    res.status(500).json({ ok: false, erro: 'Não foi possível ler os dados.' });
  }
});

// ------------------------------------------------------- DEFINIR SENHA NOVA
//
// A recuperação de conta deste jogo. Recebe o id da conta e a senha nova.
//
// Repare no que NÃO acontece aqui: nada é lido da senha antiga, e a nova não é
// devolvida na resposta nem guardada em texto - ela vira hash igual a qualquer
// outra (ver usuarios.definirSenha). O administrador combina a senha com a
// pessoa por fora; o servidor só registra.
router.post('/api/admin/senha', sóAdministrador, async (req, res) => {
  try {
    const { id, novaSenha } = req.body || {};
    const conta = await usuarios.porId(id);
    if (!conta) return res.status(404).json({ ok: false, erro: 'Conta não encontrada.' });

    await usuarios.definirSenha(conta.id, novaSenha);
    console.log(`[admin] senha redefinida para a conta ${conta.apelido} (${conta.id})`);
    res.json({ ok: true, nome: conta.apelido });
  } catch (erro) {
    const esperado = erro instanceof usuarios.ErroDeConta;
    if (!esperado) console.error('[admin]', erro);
    res.status(esperado ? 400 : 500).json({
      ok: false,
      erro: esperado ? erro.message : 'Não foi possível trocar a senha.',
    });
  }
});

// ------------------------------------------------------------- EXPORTAR CSV
//
// Baixa as contas num arquivo que o Excel e o Google Sheets abrem com dois
// cliques. É a cópia dos dados na mão do dono do jogo - a garantia de que nada
// se perde não depende de nenhuma empresa continuar existindo.
//
// A senha não vai junto, pelo mesmo motivo de sempre: uma planilha é um arquivo
// que se compartilha por link sem querer.
const paraCsv = (valor) => {
  const texto = valor === null || valor === undefined ? '' : String(valor);
  return /[",;\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
};

const dataLegivel = (t) =>
  t ? new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';

router.get('/api/admin/contas.csv', sóAdministrador, async (_req, res) => {
  try {
    const contas = await banco.tudo(
      `SELECT u.apelido, u.email, u.criado_em, u.visto_em,
              (SELECT COUNT(*) FROM resultados r WHERE r.usuario_id = u.id) AS partidas,
              (SELECT COALESCE(SUM(r.pontos), 0) FROM resultados r WHERE r.usuario_id = u.id) AS pontos
         FROM usuarios u
        ORDER BY u.criado_em DESC`
    );

    // Ponto e vírgula: é o separador que o Excel em português entende sozinho.
    // O \uFEFF na frente faz os acentos aparecerem certos ao abrir no Excel.
    const linhas = [['apelido', 'email', 'criada em', 'último acesso', 'partidas', 'pontos'].join(';')];
    for (const c of contas) {
      linhas.push(
        [c.apelido, c.email, dataLegivel(c.criado_em), dataLegivel(c.visto_em), c.partidas, c.pontos]
          .map(paraCsv)
          .join(';')
      );
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="contas-barbestial.csv"');
    res.send('\uFEFF' + linhas.join('\n'));
  } catch (erro) {
    console.error('[admin]', erro);
    res.status(500).json({ ok: false, erro: 'Não foi possível exportar.' });
  }
});

module.exports = { router, ligado };
