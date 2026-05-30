const { Pool } = require('pg');
const DEFAULT_SETTINGS = require('./settings.json');

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
      active       BOOLEAN      DEFAULT true,
      created_at   TIMESTAMP    DEFAULT NOW()
    )
  `);
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
  console.log('[DB] Tabelas prontas');
}

async function upsertStreamer({ twitch_id, login, display_name, access_token, refresh_token }) {
  await q(`
    INSERT INTO streamers (twitch_id, login, display_name, access_token, refresh_token, active)
    VALUES ($1,$2,$3,$4,$5,true)
    ON CONFLICT (twitch_id) DO UPDATE SET
      login=$2, display_name=$3, access_token=$4, refresh_token=$5, active=true
  `, [twitch_id, login, display_name, access_token, refresh_token]);

  // Cria settings padrão se for o primeiro login
  await q(`
    INSERT INTO channel_settings (twitch_id, settings)
    VALUES ($1, $2)
    ON CONFLICT (twitch_id) DO NOTHING
  `, [twitch_id, JSON.stringify(DEFAULT_SETTINGS)]);
}

async function getStreamer(twitch_id) {
  const r = await q('SELECT * FROM streamers WHERE twitch_id=$1', [twitch_id]);
  return r.rows[0] || null;
}

async function getActiveStreamers() {
  const r = await q('SELECT * FROM streamers WHERE active=true');
  return r.rows;
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

async function ping() {
  await q('SELECT 1');
}

module.exports = {
  init, upsertStreamer, getStreamer, getActiveStreamers,
  deactivateStreamer, getSettings, saveSettings,
  logCommand, getRecentLog, ping,
};
