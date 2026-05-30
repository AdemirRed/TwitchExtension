require('dotenv').config();
const tmi = require('tmi.js');
const db  = require('./db');
const cmd = require('./commands');

const CLIENT_ID = process.env.TWITCH_CLIENT_ID;

// Cache de settings por canal (evita bater no banco a cada mensagem)
const settingsCache = new Map();
const cooldowns     = new Map();
// Map: twitch_id → broadcaster_id (buscado na primeira mensagem)
const broadcasterIds = new Map();
// SSE log listeners por twitch_id
const logListeners  = new Map();

async function getSettings(twitchId) {
  if (!settingsCache.has(twitchId)) {
    settingsCache.set(twitchId, await db.getSettings(twitchId));
  }
  return settingsCache.get(twitchId);
}

function invalidateCache(twitchId) {
  settingsCache.delete(twitchId);
}

function emitLog(twitchId, entry) {
  const listeners = logListeners.get(twitchId) || new Set();
  const data = `data: ${JSON.stringify(entry)}\n\n`;
  listeners.forEach(res => res.write(data));
  db.logCommand(twitchId, entry);
}

function addLogListener(twitchId, res) {
  if (!logListeners.has(twitchId)) logListeners.set(twitchId, new Set());
  logListeners.get(twitchId).add(res);
}
function removeLogListener(twitchId, res) {
  logListeners.get(twitchId)?.delete(res);
}

function emCooldown(usuario, cmdName, settings) {
  const key   = `${usuario}:${cmdName}`;
  const ultimo = cooldowns.get(key);
  if (!ultimo) return false;
  const limit = settings.commands?.[cmdName]?.cooldown_ms ?? settings.cooldown_ms ?? 10000;
  return Date.now() - ultimo < limit;
}
function setCooldown(usuario, cmdName) {
  cooldowns.set(`${usuario}:${cmdName}`, Date.now());
}

// ── Cliente TMI único para todos os canais ────────────────────────────────────

const client = new tmi.Client({
  options: { debug: false },
  identity: {
    username: process.env.BOT_USERNAME,
    password: process.env.BOT_OAUTH_TOKEN,
  },
  channels: [],
});

client.on('message', async (channel, tags, message, self) => {
  if (self) return;
  const login    = channel.replace('#', '');
  const msg      = message.trim();
  const cmdName  = msg.split(/\s+/)[0].toLowerCase();
  const usuario  = tags['display-name'] || tags.username;

  // Busca o streamer pelo login do canal
  const streamers = await db.getActiveStreamers();
  const streamer  = streamers.find(s => s.login.toLowerCase() === login.toLowerCase());
  if (!streamer) return;

  const twitchId  = streamer.twitch_id;
  const token     = streamer.access_token;
  const settings  = await getSettings(twitchId);

  // Broadcaster ID (usa twitch_id do próprio streamer)
  const broadcasterId = twitchId;

  function say(texto) { client.say(channel, texto); }
  function log(tipo, texto, extra = {}) {
    emitLog(twitchId, { ts: Date.now(), tipo, texto, ...extra });
  }

  // ── Comandos especiais ────────────────────────────────────────────────────
  if (cmdName === '!pix')     { await cmd.handlePix(say, settings); return; }
  if (cmdName === '!uptime')  { await cmd.handleUptime(say, broadcasterId, token, CLIENT_ID); return; }
  if (cmdName === '!comandos'){ await cmd.handleComandos(say, settings); return; }

  if (cmdName === '!clip'    && settings.stream?.clip_enabled)        { await cmd.handleClip(say, tags, settings, broadcasterId, token, CLIENT_ID); log('stream','Clip criado por '+usuario); return; }
  if (cmdName === '!so'      && settings.stream?.so_enabled)          { await cmd.handleSO(say, tags, msg, settings, broadcasterId, token, CLIENT_ID); log('stream','SO por '+usuario); return; }
  if (cmdName === '!mude'    && settings.stream?.mude_titulo_enabled) { await cmd.handleMude(say, tags, msg, settings, broadcasterId, token, CLIENT_ID); log('stream','Título mudado por '+usuario); return; }
  if (cmdName === '!jogo'    && settings.stream?.mude_jogo_enabled)   { await cmd.handleJogo(say, tags, msg, settings, broadcasterId, token, CLIENT_ID); log('stream','Jogo mudado por '+usuario); return; }
  if (cmdName === '!ban'     && settings.moderation?.ban_enabled)     { await cmd.handleBan(say, tags, msg, settings, broadcasterId, token, CLIENT_ID); log('mod','BAN por '+usuario); return; }
  if (cmdName === '!timeout' && settings.moderation?.timeout_enabled) { await cmd.handleTimeout(say, tags, msg, settings, broadcasterId, token, CLIENT_ID); log('mod','TIMEOUT por '+usuario); return; }
  if (cmdName === '!unban'   && settings.moderation?.unban_enabled)   { await cmd.handleUnban(say, tags, msg, settings, broadcasterId, token, CLIENT_ID); log('mod','UNBAN por '+usuario); return; }

  // Redes sociais
  const redes = ['discord','instagram','youtube','twitter'];
  if (redes.includes(cmdName.replace('!',''))) { cmd.handleSocial(say, cmdName.replace('!',''), settings); return; }

  // ── Comandos customizados ─────────────────────────────────────────────────
  const cmdCfg = settings.commands?.[cmdName];
  if (!cmdCfg?.enabled) return;
  if (!cmd.temPermissao(tags, cmdCfg.permissao || 'todos')) return;
  if (emCooldown(usuario, cmdName, settings)) return;

  if (cmdName === '!leitar') {
    let alvo = cmd.parsearAlvo(msg);
    if (!alvo) alvo = await cmd.viewerAleatorio(broadcasterId, usuario, token, CLIENT_ID);
    if (!alvo) { say(`@${usuario} não tem ninguém pra leitar... 👀`); return; }
    if (alvo.toLowerCase() === usuario.toLowerCase()) {
      say(`@${usuario} tentou se leitar... LUL`);
      setCooldown(usuario, cmdName);
      return;
    }
    const texto = cmd.mensagemAleatoria(cmdCfg, usuario, alvo);
    say(texto);
    setCooldown(usuario, cmdName);
    log('cmd', texto, { cmd: cmdName, usuario, alvo });
    return;
  }

  const texto = cmd.mensagemAleatoria(cmdCfg, usuario, null);
  if (!texto) return;
  say(texto);
  setCooldown(usuario, cmdName);
  log('cmd', texto, { cmd: cmdName, usuario });
});

client.on('connected', () => console.log('[BOT] Conectado ao Twitch IRC'));

async function joinChannel(login) {
  try {
    await client.join(login);
    console.log(`[BOT] Entrou em #${login}`);
  } catch (e) {
    if (!e.message?.includes('already')) console.warn(`[BOT] Erro ao entrar em #${login}:`, e.message);
  }
}

async function partChannel(login) {
  try {
    await client.part(login);
    console.log(`[BOT] Saiu de #${login}`);
  } catch {}
}

async function start() {
  await client.connect();
  const streamers = await db.getActiveStreamers();
  for (const s of streamers) await joinChannel(s.login);
  console.log(`[BOT] ${streamers.length} canal(is) ativos`);
}

module.exports = { start, joinChannel, partChannel, invalidateCache, addLogListener, removeLogListener, getSettings };
