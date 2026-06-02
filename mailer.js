/**
 * Envio de e-mails via SMTP (Zoho — conta do ExplorarLocais).
 * Usado para confirmação de assinatura e lembretes de cobrança.
 */
const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    console.warn('[mail] SMTP não configurado — e-mails desativados.');
    return null;
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false, // 587 usa STARTTLS
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
}

const FROM = `"ExplorarBot" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`;
const SITE = process.env.BASE_URL || 'https://explorarbot.up.railway.app';

function layout(titulo, corpo) {
  return `
  <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;background:#18181b;border-radius:12px;overflow:hidden;border:1px solid #2a2a2d">
    <div style="background:linear-gradient(135deg,#1a0a2e,#2d1060);padding:28px 24px;text-align:center">
      <div style="font-size:22px;font-weight:800;color:#9147ff">🎮 ExplorarBot</div>
    </div>
    <div style="padding:28px 24px;color:#efeff1">
      <h2 style="font-size:18px;margin:0 0 16px">${titulo}</h2>
      <div style="font-size:14px;line-height:1.6;color:#adadb8">${corpo}</div>
    </div>
    <div style="padding:16px 24px;border-top:1px solid #2a2a2d;text-align:center;font-size:11px;color:#5a5a64">
      ExplorarBot · <a href="${SITE}" style="color:#9147ff;text-decoration:none">${SITE.replace('https://','')}</a><br>
      Conheça também o <a href="https://explorarlocais.com.br" style="color:#9147ff;text-decoration:none">ExplorarLocais</a>
    </div>
  </div>`;
}

async function enviar(para, assunto, html) {
  const t = getTransporter();
  if (!t || !para) return false;
  try {
    await t.sendMail({ from: FROM, to: para, subject: assunto, html });
    console.log(`[mail] Enviado para ${para}: ${assunto}`);
    return true;
  } catch (e) {
    console.error('[mail] erro ao enviar:', e.message);
    return false;
  }
}

// ── Templates ──────────────────────────────────────────────────────────────

function confirmacaoAssinatura(para, { plano, expira }) {
  const planoNome = plano === 'vitalicio' ? 'Vitalício 🏆' : 'Mensal ⭐';
  const validade  = plano === 'vitalicio'
    ? 'Seu acesso é <b>vitalício</b> — nunca expira!'
    : `Válido até <b>${new Date(expira).toLocaleDateString('pt-BR')}</b> (renova automaticamente).`;
  return enviar(para, '✅ Premium ativado no ExplorarBot!',
    layout('Premium ativado com sucesso!', `
      <p>Obрigado por assinar o plano <b>${planoNome}</b>! 🎉</p>
      <p>${validade}</p>
      <p>Agora você tem acesso a:</p>
      <ul>
        <li>Comandos customizados ilimitados</li>
        <li>Enquetes com pontos do canal</li>
        <li>Predições</li>
        <li>Sem anúncios no seu chat</li>
        <li>Suporte prioritário</li>
      </ul>
      <p style="margin-top:20px"><a href="${SITE}/painel" style="background:#9147ff;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block">Ir ao meu painel</a></p>
    `));
}

function lembreteCobranca(para, { valor, vencimento, invoiceUrl }) {
  return enviar(para, '🔔 Sua assinatura ExplorarBot vence em breve',
    layout('Lembrete de cobrança', `
      <p>Sua assinatura <b>Mensal</b> do ExplorarBot vence em <b>${new Date(vencimento).toLocaleDateString('pt-BR')}</b>.</p>
      <p>Valor: <b>R$ ${Number(valor).toFixed(2).replace('.', ',')}</b></p>
      <p>Para manter seus recursos Premium ativos, garanta o pagamento:</p>
      <p style="margin-top:20px"><a href="${invoiceUrl || SITE + '/premium'}" style="background:#9147ff;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block">Pagar agora</a></p>
      <p style="font-size:12px;color:#5a5a64;margin-top:16px">Se já pagou, ignore este e-mail.</p>
    `));
}

function premiumExpirado(para) {
  return enviar(para, '😢 Seu Premium do ExplorarBot expirou',
    layout('Premium expirado', `
      <p>Seu acesso Premium expirou. Os recursos exclusivos foram desativados e os anúncios voltaram ao seu chat.</p>
      <p>Quer reativar? É rápido:</p>
      <p style="margin-top:20px"><a href="${SITE}/premium" style="background:#9147ff;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block">Reativar Premium</a></p>
    `));
}

module.exports = { enviar, confirmacaoAssinatura, lembreteCobranca, premiumExpirado };
