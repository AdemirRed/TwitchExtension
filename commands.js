const fetch = require('node-fetch');

// ── Twitch API helper ─────────────────────────────────────────────────────────

async function twitchAPI(method, endpoint, body, token, clientId) {
  const res = await fetch(`https://api.twitch.tv/helix${endpoint}`, {
    method,
    headers: {
      'Client-Id': clientId,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return {};
  return res.json().catch(() => ({}));
}

// ── Permissões ────────────────────────────────────────────────────────────────

function temPermissao(tags, permissao) {
  const isBroadcaster = !!tags.badges?.broadcaster;
  const isMod         = !!(tags.mod || isBroadcaster);
  const isVip         = !!(tags.badges?.vip || isMod);
  const isSub         = !!(tags.subscriber || isVip);
  switch (permissao) {
    case 'todos':       return true;
    case 'subs':        return isSub;
    case 'vip':         return isVip;
    case 'mods':        return isMod;
    case 'broadcaster': return isBroadcaster;
    default:            return false;
  }
}

// ── Mensagem aleatória ────────────────────────────────────────────────────────

function mensagemAleatoria(cfg, usuario, alvo) {
  if (!cfg?.mensagens?.length) return null;
  const tmpl = cfg.mensagens[Math.floor(Math.random() * cfg.mensagens.length)];
  return tmpl
    .replace(/\{usuario\}/g, usuario)
    .replace(/\{alvo\}/g, alvo || '');
}

function parsearAlvo(msg) {
  const m = msg.match(/^!\w+\s+@?(\S+)/i);
  return m ? m[1].toLowerCase() : null;
}

// ── Buscar viewer aleatório ───────────────────────────────────────────────────

async function viewerAleatorio(broadcasterId, excluir, token, clientId) {
  try {
    const data = await twitchAPI('GET',
      `/chat/chatters?broadcaster_id=${broadcasterId}&moderator_id=${broadcasterId}&first=100`,
      null, token, clientId
    );
    const lista = (data.data || [])
      .map(c => c.user_login)
      .filter(n => n.toLowerCase() !== excluir.toLowerCase());
    return lista.length ? lista[Math.floor(Math.random() * lista.length)] : null;
  } catch { return null; }
}

async function buscarUserId(login, token, clientId) {
  const data = await twitchAPI('GET', `/users?login=${login}`, null, token, clientId);
  return data.data?.[0]?.id || null;
}

async function buscarJogo(nome, token, clientId) {
  const data = await twitchAPI('GET', `/games?name=${encodeURIComponent(nome)}`, null, token, clientId);
  return data.data?.[0] || null;
}

async function buscarStream(broadcasterId, token, clientId) {
  const data = await twitchAPI('GET', `/streams?user_id=${broadcasterId}`, null, token, clientId);
  return data.data?.[0] || null;
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handlePix(say, settings) {
  const p = settings.pix;
  if (!p?.enabled || !p?.chave) {
    say('Chave Pix não configurada. Peça ao streamer configurar no painel!');
    return;
  }
  say(`💸 Pix → Tipo: ${p.tipo} | Chave: ${p.chave}`);
}

async function handleBan(say, tags, msg, settings, broadcasterId, token, clientId) {
  if (settings.moderation?.apenas_mods && !temPermissao(tags, 'mods')) return;
  const partes = msg.split(/\s+/);
  const alvo   = partes[1]?.replace('@', '');
  const razao  = partes.slice(2).join(' ') || 'Banido pelo bot';
  if (!alvo) { say('Uso: !ban @usuario [motivo]'); return; }
  const alvoId = await buscarUserId(alvo, token, clientId);
  if (!alvoId) { say(`Usuário @${alvo} não encontrado.`); return; }
  const r = await twitchAPI('POST', '/moderation/bans', {
    broadcaster_id: broadcasterId, moderator_id: broadcasterId,
    data: { user_id: alvoId, reason: razao },
  }, token, clientId);
  if (r.data) say(`🔨 @${alvo} foi banido. Motivo: ${razao}`);
  else say(`Não foi possível banir @${alvo}.`);
}

async function handleTimeout(say, tags, msg, settings, broadcasterId, token, clientId) {
  if (settings.moderation?.apenas_mods && !temPermissao(tags, 'mods')) return;
  const partes   = msg.split(/\s+/);
  const alvo     = partes[1]?.replace('@', '');
  const segundos = parseInt(partes[2]) || 600;
  const razao    = partes.slice(3).join(' ') || 'Timeout pelo bot';
  if (!alvo) { say('Uso: !timeout @usuario [segundos] [motivo]'); return; }
  const alvoId = await buscarUserId(alvo, token, clientId);
  if (!alvoId) { say(`Usuário @${alvo} não encontrado.`); return; }
  const r = await twitchAPI('POST', '/moderation/bans', {
    broadcaster_id: broadcasterId, moderator_id: broadcasterId,
    data: { user_id: alvoId, duration: segundos, reason: razao },
  }, token, clientId);
  if (r.data) {
    const t = segundos >= 60 ? `${Math.floor(segundos/60)}min` : `${segundos}s`;
    say(`⏱ @${alvo} levou timeout de ${t}. Motivo: ${razao}`);
  } else say(`Não foi possível dar timeout em @${alvo}.`);
}

async function handleUnban(say, tags, msg, settings, broadcasterId, token, clientId) {
  if (settings.moderation?.apenas_mods && !temPermissao(tags, 'mods')) return;
  const alvo = msg.split(/\s+/)[1]?.replace('@', '');
  if (!alvo) { say('Uso: !unban @usuario'); return; }
  const alvoId = await buscarUserId(alvo, token, clientId);
  if (!alvoId) { say(`Usuário @${alvo} não encontrado.`); return; }
  await twitchAPI('DELETE',
    `/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${broadcasterId}&user_id=${alvoId}`,
    null, token, clientId
  );
  say(`✅ @${alvo} foi desbanido.`);
}

async function handleMude(say, tags, msg, settings, broadcasterId, token, clientId) {
  if (settings.stream?.apenas_mods && !temPermissao(tags, 'mods')) return;
  const titulo = msg.replace(/^!mude\s*/i, '').trim();
  if (!titulo) { say('Uso: !mude Novo título da live'); return; }
  await twitchAPI('PATCH', `/channels?broadcaster_id=${broadcasterId}`, { title: titulo }, token, clientId);
  say(`✏️ Título alterado para: "${titulo}"`);
}

async function handleJogo(say, tags, msg, settings, broadcasterId, token, clientId) {
  if (settings.stream?.apenas_mods && !temPermissao(tags, 'mods')) return;
  const nome = msg.replace(/^!jogo\s*/i, '').trim();
  if (!nome) { say('Uso: !jogo Nome do Jogo'); return; }
  const jogo = await buscarJogo(nome, token, clientId);
  if (!jogo) { say(`Jogo "${nome}" não encontrado.`); return; }
  await twitchAPI('PATCH', `/channels?broadcaster_id=${broadcasterId}`, { game_id: jogo.id }, token, clientId);
  say(`🎮 Jogo alterado para: ${jogo.name}`);
}

async function handleClip(say, tags, settings, broadcasterId, token, clientId) {
  if (settings.stream?.apenas_mods && !temPermissao(tags, 'mods')) return;
  const r = await twitchAPI('POST', `/clips?broadcaster_id=${broadcasterId}`, null, token, clientId);
  if (r.data?.[0]) say(`🎬 Clip criado! https://clips.twitch.tv/${r.data[0].id}`);
  else say('Não foi possível criar o clip. A live está ao vivo?');
}

async function handleSO(say, tags, msg, settings, broadcasterId, token, clientId) {
  if (settings.stream?.apenas_mods && !temPermissao(tags, 'mods')) return;
  const alvo = msg.split(/\s+/)[1]?.replace('@', '');
  if (!alvo) { say('Uso: !so @streamer'); return; }
  const alvoId = await buscarUserId(alvo, token, clientId);
  if (!alvoId) { say(`Usuário @${alvo} não encontrado.`); return; }
  await twitchAPI('POST', '/chat/shoutouts', {
    from_broadcaster_id: broadcasterId,
    to_broadcaster_id: alvoId,
    moderator_id: broadcasterId,
  }, token, clientId);
  say(`📣 Confira o canal de @${alvo}! twitch.tv/${alvo}`);
}

async function handleUptime(say, broadcasterId, token, clientId) {
  const stream = await buscarStream(broadcasterId, token, clientId);
  if (!stream) { say('A live não está ao vivo agora.'); return; }
  const diff = Date.now() - new Date(stream.started_at).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  say(`⏱ Live há ${h}h ${m}min`);
}

async function handleComandos(say, settings) {
  const ativos = Object.entries(settings.commands || {})
    .filter(([, c]) => c.enabled).map(([cmd]) => cmd);
  const extras = [];
  if (settings.pix?.enabled && settings.pix?.chave) extras.push('!pix');
  if (settings.moderation?.ban_enabled)     extras.push('!ban', '!timeout', '!unban');
  if (settings.stream?.mude_titulo_enabled) extras.push('!mude');
  if (settings.stream?.mude_jogo_enabled)   extras.push('!jogo');
  if (settings.stream?.clip_enabled)        extras.push('!clip');
  if (settings.stream?.so_enabled)          extras.push('!so');
  if (settings.stream?.uptime_enabled)      extras.push('!uptime');
  if (settings.social?.discord)             extras.push('!discord');
  const todos = [...new Set([...ativos, ...extras])];
  say(`📋 Comandos: ${todos.join(' | ')}`);
}

function handleSocial(say, rede, settings) {
  const url = settings.social?.[rede];
  if (!url) return;
  const icons = { discord:'💬', instagram:'📸', youtube:'▶️', twitter:'🐦' };
  say(`${icons[rede]||'🔗'} ${rede.charAt(0).toUpperCase()+rede.slice(1)}: ${url}`);
}

module.exports = {
  temPermissao, mensagemAleatoria, parsearAlvo, viewerAleatorio,
  twitchAPI, buscarUserId,
  handlePix, handleBan, handleTimeout, handleUnban,
  handleMude, handleJogo, handleClip, handleSO,
  handleUptime, handleComandos, handleSocial,
};
