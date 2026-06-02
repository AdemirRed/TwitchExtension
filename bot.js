require('dotenv').config();
const tmi   = require('tmi.js');
const fetch = require('node-fetch');
const db    = require('./db');
const cmd   = require('./commands');

const CLIENT_ID     = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

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

// ── Renovação automática do token do bot ──────────────────────────────────────
// O bot guarda access_token + refresh_token no banco (config). O access_token
// expira em ~4h, então renovamos usando o refresh_token (que é longo). Assim o
// bot nunca mais precisa de atualização manual de token.

async function renovarTokenBot() {
  const refresh = await db.getConfig('bot_refresh_token');
  if (!refresh) return null;

  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refresh,
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    console.error('[BOT] Falha ao renovar token:', JSON.stringify(data));
    return null;
  }
  await db.setConfig('bot_access_token', data.access_token);
  if (data.refresh_token) await db.setConfig('bot_refresh_token', data.refresh_token);
  console.log('[BOT] Token renovado com sucesso');
  return data.access_token;
}

// ── Cliente TMI único para todos os canais ────────────────────────────────────

let client = null;

function criarClient(username, token) {
  return new tmi.Client({
    options: { debug: false },
    connection: { reconnect: true, secure: true },
    identity: { username, password: `oauth:${token}` },
    channels: [],
  });
}

async function onMessage(channel, tags, message, self) {
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
  if (cmdName === '!comandos'){ await cmd.handleComandos(say, settings, login, process.env.BASE_URL); return; }

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
}

async function joinChannel(login) {
  if (!client) return;
  try {
    await client.join(login);
    console.log(`[BOT] Entrou em #${login}`);
  } catch (e) {
    if (!e.message?.includes('already')) console.warn(`[BOT] Erro ao entrar em #${login}:`, e.message);
  }
}

async function partChannel(login) {
  if (!client) return;
  try {
    await client.part(login);
    console.log(`[BOT] Saiu de #${login}`);
  } catch {}
}

let refreshTimer = null;

async function start() {
  // 1. Pega/renova o token do bot a partir do refresh_token guardado no banco
  let username = await db.getConfig('bot_username');
  let token    = await renovarTokenBot();

  if (!username || !token) {
    console.warn('\n⚠️  Bot não configurado. Acesse /setup-bot e faça login com a conta do bot UMA vez.');
    console.warn('   Depois o token renova sozinho pra sempre.\n');
    return;
  }

  // 2. Cria o cliente TMI com o token fresco
  client = criarClient(username, token);
  client.on('message', onMessage);
  client.on('connected', () => console.log('[BOT] Conectado ao Twitch IRC'));

  await client.connect();

  // 3. Entra em todos os canais ativos
  const streamers = await db.getActiveStreamers();
  for (const s of streamers) await joinChannel(s.login);
  console.log(`[BOT] ${streamers.length} canal(is) ativos`);

  // 4. Renova o token a cada 3h e reconecta com o novo
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(reconectarComTokenNovo, 3 * 60 * 60 * 1000);

  // 5. ADS horária nos canais NÃO-premium
  iniciarAds();
}

// ── ADS automática (a cada 1h, só em canais não-premium) ──────────────────────
const ADS = [
  '📢 Curtiu o bot? Adicione no seu canal de graça: https://explorarbot.up.railway.app',
  '🗺️ Conheça o ExplorarLocais — descubra os melhores pontos turísticos do Brasil: https://explorarlocais.com.br',
];
let adsTimer = null;
let adsIndex = 0;

function iniciarAds() {
  if (adsTimer) clearInterval(adsTimer);
  // A cada 1 hora
  adsTimer = setInterval(async () => {
    try {
      const streamers = await db.getActiveStreamers();
      const msg = ADS[adsIndex % ADS.length];
      adsIndex++;
      for (const s of streamers) {
        // Assinantes premium não recebem ADS
        if (await db.isPremium(s.twitch_id)) continue;
        try { if (client) await client.say(`#${s.login}`, msg); } catch {}
      }
    } catch (e) {
      console.error('[ADS] erro:', e.message);
    }
  }, 60 * 60 * 1000);
}

async function reconectarComTokenNovo() {
  try {
    const token    = await renovarTokenBot();
    const username = await db.getConfig('bot_username');
    if (!token || !username) return;

    const canais = client ? [...client.getChannels()] : [];
    try { if (client) await client.disconnect(); } catch {}

    client = criarClient(username, token);
    client.on('message', onMessage);
    client.on('connected', () => console.log('[BOT] Reconectado com token novo'));
    await client.connect();
    for (const ch of canais) await joinChannel(ch.replace('#', ''));
  } catch (e) {
    console.error('[BOT] Erro ao reconectar:', e.message);
  }
}

// Envia uma mensagem diretamente em um canal (usado pelo painel para testar)
async function sayInChannel(login, texto) {
  if (!client) throw new Error('Bot não conectado');
  await client.say(`#${login}`, texto);
}

// Invoca um comando como se viesse do broadcaster (usado pelo painel)
async function invocarComando(login, msg) {
  if (!client) throw new Error('Bot não conectado');
  const fakeTags = {
    'display-name': login,
    username: login,
    mod: true,
    subscriber: true,
    badges: { broadcaster: '1' },
  };
  await onMessage(`#${login}`, fakeTags, msg, false);
}

module.exports = {
  start, joinChannel, partChannel, invalidateCache,
  addLogListener, removeLogListener, getSettings,
  sayInChannel, invocarComando,
};
