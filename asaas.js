const fetch = require('node-fetch');

const BASE = process.env.ASAAS_BASE_URL || 'https://api.asaas.com/v3';
const KEY  = process.env.ASAAS_API_KEY;

function headers() {
  return { 'access_token': KEY, 'Content-Type': 'application/json' };
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// Cria ou recupera cliente pelo CPF
async function upsertCliente({ nome, cpf, email }) {
  // Tenta buscar pelo CPF primeiro
  const busca = await api('GET', `/customers?cpfCnpj=${cpf.replace(/\D/g,'')}`);
  if (busca.data?.length > 0) return busca.data[0];

  return api('POST', '/customers', {
    name:      nome,
    cpfCnpj:   cpf.replace(/\D/g,''),
    email:     email || undefined,
    notificationDisabled: true,
  });
}

// Cria cobrança PIX com referência ao twitch_id
async function criarCobrancaPix({ clienteId, twitchId, twitchLogin, valor }) {
  const venc = new Date();
  venc.setDate(venc.getDate() + 1); // vence amanhã

  return api('POST', '/payments', {
    customer:         clienteId,
    billingType:      'PIX',
    value:            parseFloat(valor || process.env.PREMIUM_PRECO || '9.00'),
    dueDate:          venc.toISOString().split('T')[0],
    description:      `Premium ExplorarLocais Bot — @${twitchLogin}`,
    externalReference: twitchId,
  });
}

// Busca QR code de uma cobrança PIX
async function getPixQrCode(paymentId) {
  return api('GET', `/payments/${paymentId}/pixQrCode`);
}

// Busca status de um pagamento
async function getPayment(paymentId) {
  return api('GET', `/payments/${paymentId}`);
}

// Verifica token do webhook
function verificarWebhook(token) {
  return token === process.env.ASAAS_WEBHOOK_TOKEN;
}

module.exports = { upsertCliente, criarCobrancaPix, getPixQrCode, getPayment, verificarWebhook };
