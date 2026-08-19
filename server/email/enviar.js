// Envio de e-mail.
//
// SEM PROVEDOR CONFIGURADO, NADA QUEBRA: o e-mail vai para o console do
// servidor, com o link inteiro. Isso permite desenvolver e testar o fluxo
// completo hoje, sem conta em servico nenhum - e, se o SMTP cair em producao,
// voce ainda consegue recuperar a conta de alguem lendo o log.
//
// PROVEDOR: qualquer um que fale SMTP (Gmail com senha de app, Brevo, Resend,
// Mailgun...). E so preencher as variaveis; nenhum codigo muda.
//
//   SMTP_HOST=smtp.gmail.com
//   SMTP_PORTA=587
//   SMTP_USUARIO=voce@gmail.com
//   SMTP_SENHA=<senha de app>
//   EMAIL_REMETENTE="Bar Bestial <voce@gmail.com>"
//   URL_PUBLICA=https://barbestial.onrender.com
//
// O ENVIO NUNCA DERRUBA O PEDIDO. Se o provedor estiver fora do ar, a conta e
// criada assim mesmo e a pessoa usa o botao de reenviar. Falhar em enviar um
// e-mail nao pode custar um cadastro.

const nodemailer = require('nodemailer');

const CONFIG = {
  host: process.env.SMTP_HOST || '',
  porta: Number(process.env.SMTP_PORTA || 587),
  usuario: process.env.SMTP_USUARIO || '',
  senha: process.env.SMTP_SENHA || '',
  remetente: process.env.EMAIL_REMETENTE || 'Bar Bestial <nao-responda@barbestial.local>',
};

const ligado = () => Boolean(CONFIG.host && CONFIG.usuario);

// O endereco publico do jogo, usado para montar os links dos e-mails.
// No Render, RENDER_EXTERNAL_URL ja vem preenchida sozinha.
const enderecoPublico = () =>
  (process.env.URL_PUBLICA || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3001}`)
    .replace(/\/+$/, '');

let correio = null;
function obterCorreio() {
  if (correio) return correio;
  correio = nodemailer.createTransport({
    host: CONFIG.host,
    port: CONFIG.porta,
    secure: CONFIG.porta === 465, // 465 e TLS direto; 587 sobe para TLS depois
    auth: { user: CONFIG.usuario, pass: CONFIG.senha },
  });
  return correio;
}

// Guardado em memoria para os testes conseguirem ler o que "foi enviado" sem
// precisar de servidor de e-mail. Fica com os ultimos 50.
const enviados = [];
const ultimosEnviados = () => enviados.slice();

async function enviar({ para, assunto, texto, html }) {
  const mensagem = { from: CONFIG.remetente, to: para, subject: assunto, text: texto, html };

  enviados.push({ para, assunto, texto, quando: Date.now() });
  if (enviados.length > 50) enviados.shift();

  if (!ligado()) {
    // Modo console. O separador existe para o link ser facil de achar no log.
    console.log(
      `\n──────── E-MAIL (SMTP não configurado) ────────\n` +
        `Para: ${para}\nAssunto: ${assunto}\n\n${texto}\n` +
        `───────────────────────────────────────────────\n`
    );
    return { ok: true, modo: 'console' };
  }

  try {
    await obterCorreio().sendMail(mensagem);
    return { ok: true, modo: 'smtp' };
  } catch (erro) {
    // De proposito nao relancamos: quem chamou continua o fluxo.
    console.error('[email] falha ao enviar para', para, '-', erro.message);
    return { ok: false, erro: erro.message };
  }
}

// ------------------------------------------------------------------ modelos

const rodape = `\n\nSe não foi você quem pediu, pode ignorar este e-mail.\n— Bar Bestial`;

// Um HTML propositalmente simples: e o que atravessa melhor os filtros de spam
// e funciona em qualquer cliente de e-mail.
const pagina = (titulo, frase, botao, link) => `
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#0d1017;padding:28px;color:#edf1f8">
  <div style="max-width:480px;margin:0 auto;background:#191f2b;border:1px solid #2e3546;border-radius:14px;padding:26px">
    <h1 style="margin:0 0 14px;font-size:19px;color:#f2b134">${titulo}</h1>
    <p style="margin:0 0 20px;line-height:1.6;font-size:15px">${frase}</p>
    <a href="${link}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:#f2b134;color:#23180a;font-weight:700;text-decoration:none">${botao}</a>
    <p style="margin:22px 0 0;font-size:12px;color:#93a0b8;line-height:1.6">
      Se o botão não funcionar, copie este endereço:<br>
      <span style="word-break:break-all">${link}</span>
    </p>
    <p style="margin:16px 0 0;font-size:12px;color:#93a0b8">
      Se não foi você quem pediu, pode ignorar este e-mail.
    </p>
  </div>
</div>`;

function enviarVerificacao(usuario, token) {
  const link = `${enderecoPublico()}/api/conta/verificar?t=${token}`;
  return enviar({
    para: usuario.email,
    assunto: 'Confirme seu e-mail — Bar Bestial',
    texto:
      `Oi, ${usuario.apelido}!\n\n` +
      `Confirme seu e-mail para entrar no ranking semanal:\n${link}\n\n` +
      `O link vale por 2 dias.${rodape}`,
    html: pagina(
      `Oi, ${usuario.apelido}!`,
      'Confirme seu e-mail para a sua pontuação valer no ranking semanal. O link vale por 2 dias.',
      'Confirmar meu e-mail',
      link
    ),
  });
}

function enviarRecuperacao(usuario, token) {
  const link = `${enderecoPublico()}/?redefinir=${token}`;
  return enviar({
    para: usuario.email,
    assunto: 'Redefinir sua senha — Bar Bestial',
    texto:
      `Oi, ${usuario.apelido}!\n\n` +
      `Para definir uma senha nova, abra este endereço:\n${link}\n\n` +
      `O link vale por 1 hora e só pode ser usado uma vez.${rodape}`,
    html: pagina(
      `Oi, ${usuario.apelido}!`,
      'Clique abaixo para definir uma senha nova. O link vale por 1 hora e só pode ser usado uma vez.',
      'Definir nova senha',
      link
    ),
  });
}

module.exports = {
  ligado,
  enviar,
  enviarVerificacao,
  enviarRecuperacao,
  enderecoPublico,
  ultimosEnviados,
};
