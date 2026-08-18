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
// administrador. Não há como recuperar a senha de ninguém - ela não está
// guardada em lugar nenhum (ver server/dados/usuarios.js).

const path = require('path');
const crypto = require('crypto');
const express = require('express');

const { abrir } = require('../dados/banco');
const ranking = require('../dados/ranking');

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

router.get('/api/admin/dados', sóAdministrador, (req, res) => {
  const banco = abrir();
  const semana = req.query.semana ? String(req.query.semana) : ranking.chaveDaSemana();

  // Repare nas colunas: nem senha_hash nem senha_sal aparecem na consulta.
  const contas = banco
    .prepare(
      `SELECT u.id, u.apelido AS nome, u.google_email, u.criado_em, u.visto_em, u.senha_trocada_em,
              (SELECT COUNT(*) FROM resultados r WHERE r.usuario_id = u.id) AS partidas,
              (SELECT COALESCE(SUM(r.pontos), 0) FROM resultados r WHERE r.usuario_id = u.id) AS pontosTotais
         FROM usuarios u
        ORDER BY u.criado_em DESC`
    )
    .all();

  const partidas = banco
    .prepare(
      `SELECT p.id, p.sala, p.terminou_em, p.semana, p.jogadores,
              (SELECT GROUP_CONCAT(u.apelido || ' (' || r.posicao || 'º, ' || r.pontos || 'pt)', ', ')
                 FROM resultados r JOIN usuarios u ON u.id = r.usuario_id
                WHERE r.partida_id = p.id
                ORDER BY r.posicao) AS quem
         FROM partidas p
        ORDER BY p.terminou_em DESC
        LIMIT 30`
    )
    .all();

  res.json({
    ok: true,
    agora: Date.now(),
    semana: ranking.semanaAtual(),
    semanaConsultada: semana,
    contas,
    ranking: ranking.rankingDaSemana(semana),
    partidas,
    totais: {
      contas: contas.length,
      partidas: banco.prepare('SELECT COUNT(*) AS n FROM partidas').get().n,
      semanas: ranking.semanasComPartidas(),
    },
  });
});

module.exports = { router, ligado };
