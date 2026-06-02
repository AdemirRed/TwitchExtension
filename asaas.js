const fetch = require('node-fetch');

const BASE = process.env.ASAAS_BASE_URL || 'https://api.asaas.com/v3';
const KEY  = process.env.ASAAS_API_KEY;

// Preços
const PRECO_MENSAL    = parseFloat(process.env.PRECO_MENSAL    || '10.99');
const PRECO_VITALICIO = parseFloat(process.env.PRECO_VITALICIO || '150.00');

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
  const cpfLimpo = cpf.replace(/\D/g, '');
  const busca = await api('GET', `/customers?cpfCnpj=${cpfLimpo}`);
  if (busca.data?.length > 0) {
    // Atualiza e-mail se mudou
    if (email && busca.data[0].email !== email) {
      await api('POST', `/customers/${busca.data[0].id}`, { email });
    }
    return busca.data[0];
  }
  return api('POST', '/customers', {
    name: nome,
    cpfCnpj: cpfLimpo,
    email: email || undefined,
    notificationDisabled: false, // deixa o Asaas mandar lembretes também
  });
}

// ── VITALÍCIO: cobrança única, cliente escolhe o método (pix/cartão/boleto) ───
async function criarCobrancaVitalicio({ clienteId, twitchId }) {
  const venc = new Date();
  venc.setDate(venc.getDate() + 3); // 3 dias para pagar

  return api('POST', '/payments', {
    customer:          clienteId,
    billingType:       'UNDEFINED', // cliente escolhe na página do Asaas
    value:             PRECO_VITALICIO,
    dueDate:           venc.toISOString().split('T')[0],
    description:       'ExplorarBot Premium — Acesso Vitalício',
    externalReference: `${twitchId}:vitalicio`,
  });
}

// ── MENSAL: assinatura recorrente no CARTÃO (auto-renova sozinha) ─────────────
async function criarAssinaturaMensal({ clienteId, twitchId }) {
  const proxVenc = new Date();
  proxVenc.setDate(proxVenc.getDate() + 1);

  return api('POST', '/subscriptions', {
    customer:          clienteId,
    billingType:       'CREDIT_CARD', // cartão tokenizado → cobra automático todo mês
    value:             PRECO_MENSAL,
    nextDueDate:       proxVenc.toISOString().split('T')[0],
    cycle:             'MONTHLY',
    description:       'ExplorarBot Premium — Plano Mensal',
    externalReference: `${twitchId}:mensal`,
  });
}

// Busca o link de pagamento (invoiceUrl) da primeira cobrança de uma assinatura
async function getPrimeiraCobrancaAssinatura(subscriptionId) {
  const data = await api('GET', `/subscriptions/${subscriptionId}/payments`);
  return data.data?.[0] || null;
}

async function getPayment(paymentId) {
  return api('GET', `/payments/${paymentId}`);
}

async function cancelarAssinatura(subscriptionId) {
  return api('DELETE', `/subscriptions/${subscriptionId}`);
}

function verificarWebhook(token) {
  return token === process.env.ASAAS_WEBHOOK_TOKEN;
}

module.exports = {
  PRECO_MENSAL, PRECO_VITALICIO,
  upsertCliente, criarCobrancaVitalicio, criarAssinaturaMensal,
  getPrimeiraCobrancaAssinatura, getPayment, cancelarAssinatura,
  verificarWebhook,
};
