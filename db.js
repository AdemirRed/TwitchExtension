const { Pool }          = require('pg');
const { encrypt, decrypt } = require('./crypto-util');
const DEFAULT_SETTINGS  = require('./settings.json');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

async function q(sql, params = []) {
  const client = await pool.connect();
  try { return await client.query(sql, params); }
  finally { client.release(); }
}

async function init() {
  await q(`
    CREATE TABLE IF NOT EXISTS streamers (
      twitch_id    VARCHAR(50)  PRIMARY KEY,
      login        VARCHAR(100) NOT NULL,
      display_name VARCHAR(100),
      access_token TEXT,
      refresh_token TEXT,
      active            BOOLEAN      DEFAULT true,
      premium           BOOLEAN      DEFAULT false,
      premium_expires_at TIMESTAMP   DEFAULT NULL,
      asaas_customer_id VARCHAR(100) DEFAULT NULL,
      created_at        TIMESTAMP    DEFAULT NOW()
    )
  `);
  // Adiciona colunas premium se já existir a tabela (migração segura)
  await q(`ALTER TABLE streamers ADD COLUMN IF NOT EXISTS premium BOOLEAN DEFAULT false`).catch(()=>{});
  await q(`ALTER TABLE streamers ADD COLUMN IF NOT EXISTS premium_expires_at TIMESTAMP DEFAULT NULL`).catch(()=>{});
  await q(`ALTER TABLE streamers ADD COLUMN IF NOT EXISTS asaas_customer_id VARCHAR(100) DEFAULT NULL`).catch(()=>{});
  await q(`ALTER TABLE streamers ADD COLUMN IF NOT EXISTS plano VARCHAR(20) DEFAULT NULL`).catch(()=>{});
  await q(`ALTER TABLE streamers ADD COLUMN IF NOT EXISTS asaas_subscription_id VARCHAR(100) DEFAULT NULL`).catch(()=>{});
  await q(`ALTER TABLE streamers ADD COLUMN IF NOT EXISTS email VARCHAR(200) DEFAULT NULL`).catch(()=>{});
  await q(`ALTER TABLE streamers ADD COLUMN IF NOT EXISTS lembrete_enviado BOOLEAN DEFAULT false`).catch(()=>{});
  await q(`
    CREATE TABLE IF NOT EXISTS channel_settings (
      twitch_id  VARCHAR(50) PRIMARY KEY REFERENCES streamers(twitch_id) ON DELETE CASCADE,
      settings   JSONB       NOT NULL DEFAULT '{}',
      updated_at TIMESTAMP   DEFAULT NOW()
    )
  `);
  await q(`
    CREATE TABLE IF NOT EXISTS command_log (
      id         SERIAL      PRIMARY KEY,
      twitch_id  VARCHAR(50),
      tipo       VARCHAR(20),
      cmd        VARCHAR(50),
      usuario    VARCHAR(100),
      alvo       VARCHAR(100),
      msg        TEXT,
      created_at TIMESTAMP   DEFAULT NOW()
    )
  `);
  // Config chave-valor (guarda tokens do bot que se renovam sozinhos)
  await q(`
    CREATE TABLE IF NOT EXISTS app_config (
      chave VARCHAR(80) PRIMARY KEY,
      valor TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  console.log('[DB] Tabelas prontas');
}

// getConfig / setConfig — tokens do bot também criptografados
async function getConfig(chave) {
  const r = await q('SELECT valor FROM app_config WHERE chave=$1', [chave]);
  const val = r.rows[0]?.valor ?? null;
  return val ? decrypt(val) : null;
}

async function setConfig(chave, valor) {
  await q(`
    INSERT INTO app_config (chave, valor) VALUES ($1,$2)
    ON CONFLICT (chave) DO UPDATE SET valor=$2, updated_at=NOW()
  `, [chave, encrypt(valor)]);
}

// Converte row do banco: descriptografa tokens sensíveis
function decryptStreamer(row) {
  if (!row) return null;
  return {
    ...row,
    access_token:  decrypt(row.access_token),
    refresh_token: decrypt(row.refresh_token),
  };
}

async function upsertStreamer({ twitch_id, login, display_name, access_token, refresh_token }) {
  // Salva tokens criptografados
  await q(`
    INSERT INTO streamers (twitch_id, login, display_name, access_token, refresh_token, active)
    VALUES ($1,$2,$3,$4,$5,true)
    ON CONFLICT (twitch_id) DO UPDATE SET
      login=$2, display_name=$3, access_token=$4, refresh_token=$5, active=true
  `, [twitch_id, login, display_name, encrypt(access_token), encrypt(refresh_token)]);

  // Cria settings padrão se for o primeiro login
  await q(`
    INSERT INTO channel_settings (twitch_id, settings)
    VALUES ($1, $2)
    ON CONFLICT (twitch_id) DO NOTHING
  `, [twitch_id, JSON.stringify(DEFAULT_SETTINGS)]);
}

async function getStreamer(twitch_id) {
  const r = await q('SELECT * FROM streamers WHERE twitch_id=$1', [twitch_id]);
  return decryptStreamer(r.rows[0]);
}

async function getActiveStreamers() {
  const r = await q('SELECT * FROM streamers WHERE active=true');
  return r.rows.map(decryptStreamer);
}

async function deactivateStreamer(twitch_id) {
  await q('UPDATE streamers SET active=false WHERE twitch_id=$1', [twitch_id]);
}

async function getSettings(twitch_id) {
  const r = await q('SELECT settings FROM channel_settings WHERE twitch_id=$1', [twitch_id]);
  return r.rows[0]?.settings ?? { ...DEFAULT_SETTINGS };
}

async function saveSettings(twitch_id, settings) {
  await q(`
    INSERT INTO channel_settings (twitch_id, settings)
    VALUES ($1,$2)
    ON CONFLICT (twitch_id) DO UPDATE SET settings=$2, updated_at=NOW()
  `, [twitch_id, JSON.stringify(settings)]);
}

async function logCommand(twitch_id, entry) {
  const { tipo, cmd, usuario, alvo, msg } = entry;
  await q(
    'INSERT INTO command_log (twitch_id,tipo,cmd,usuario,alvo,msg) VALUES ($1,$2,$3,$4,$5,$6)',
    [twitch_id, tipo, cmd || null, usuario || null, alvo || null, msg || null]
  ).catch(() => {}); // log nunca deve travar o bot
}

async function getRecentLog(twitch_id, limit = 100) {
  const r = await q(
    'SELECT * FROM command_log WHERE twitch_id=$1 ORDER BY created_at DESC LIMIT $2',
    [twitch_id, limit]
  );
  return r.rows.reverse();
}

// Ativa premium conforme o plano:
//  - vitalicio: nunca expira (premium_expires_at = NULL)
//  - mensal: soma 1 mês a partir do maior entre hoje e expiração atual
async function ativarPremium(twitch_id, plano = 'mensal') {
  if (plano === 'vitalicio') {
    await q(
      `UPDATE streamers SET premium=true, premium_expires_at=NULL, plano='vitalicio', lembrete_enviado=false WHERE twitch_id=$1`,
      [twitch_id]
    );
    return;
  }
  // mensal
  const atual = await getStreamer(twitch_id);
  const base  = atual?.premium_expires_at && new Date(atual.premium_expires_at) > new Date()
    ? new Date(atual.premium_expires_at)
    : new Date();
  base.setMonth(base.getMonth() + 1);
  await q(
    `UPDATE streamers SET premium=true, premium_expires_at=$2, plano='mensal', lembrete_enviado=false WHERE twitch_id=$1`,
    [twitch_id, base]
  );
}

async function salvarAsaasCliente(twitch_id, asaas_customer_id) {
  await q(`UPDATE streamers SET asaas_customer_id=$2 WHERE twitch_id=$1`, [twitch_id, asaas_customer_id]);
}

async function salvarAssinatura(twitch_id, subscription_id) {
  await q(`UPDATE streamers SET asaas_subscription_id=$2 WHERE twitch_id=$1`, [twitch_id, subscription_id]);
}

async function salvarEmailStreamer(twitch_id, email) {
  await q(`UPDATE streamers SET email=$2 WHERE twitch_id=$1`, [twitch_id, email]);
}

async function isPremium(twitch_id) {
  const r = await q(`SELECT premium, premium_expires_at FROM streamers WHERE twitch_id=$1`, [twitch_id]);
  const s = r.rows[0];
  if (!s?.premium) return false;
  if (!s.premium_expires_at) return true; // vitalício
  return new Date(s.premium_expires_at) > new Date();
}

// Streamers mensais cujo premium vence em N dias (para lembrete) e ainda não notificados
async function premiumVencendo(dias = 3) {
  const r = await q(`
    SELECT * FROM streamers
    WHERE premium=true AND plano='mensal'
      AND premium_expires_at IS NOT NULL
      AND premium_expires_at <= NOW() + INTERVAL '${dias} days'
      AND premium_expires_at > NOW()
      AND lembrete_enviado=false
  `);
  return r.rows.map(decryptStreamer);
}

// Streamers cujo premium já expirou mas ainda está marcado como premium
async function premiumExpirados() {
  const r = await q(`
    SELECT * FROM streamers
    WHERE premium=true AND premium_expires_at IS NOT NULL AND premium_expires_at < NOW()
  `);
  return r.rows.map(decryptStreamer);
}

async function marcarLembreteEnviado(twitch_id) {
  await q(`UPDATE streamers SET lembrete_enviado=true WHERE twitch_id=$1`, [twitch_id]);
}

async function desativarPremium(twitch_id) {
  await q(`UPDATE streamers SET premium=false WHERE twitch_id=$1`, [twitch_id]);
}

async function ping() {
  await q('SELECT 1');
}

module.exports = {
  init, upsertStreamer, getStreamer, getActiveStreamers,
  deactivateStreamer, getSettings, saveSettings,
  logCommand, getRecentLog,
  ativarPremium, salvarAsaasCliente, salvarAssinatura, salvarEmailStreamer, isPremium,
  premiumVencendo, premiumExpirados, marcarLembreteEnviado, desativarPremium,
  getConfig, setConfig,
  ping,
};
