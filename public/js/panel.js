// ═══════════════════════════════════════════════════════════════
// panel.js — Painel ExplorarBot com abas
// Abas: Comandos, Canal, Enquetes, Previsões, Recompensas
// ═══════════════════════════════════════════════════════════════

const BACKEND = 'https://explorarbot.up.railway.app';

const PERM_LABEL = {
  todos: 'Todos', subs: 'Subs', vip: 'VIP', mods: 'Mods', broadcaster: 'Streamer'
};

// ── Config da extensão (toggles salvos pelo broadcaster) ──
let extCfg = {
  showPolls:       true,
  showPredictions: true,
  showAlerts:      true,
};

// ── Sistema de abas ──
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab)?.classList.add('active');
    // Remove badge de notificação ao abrir a aba
    btn.querySelector('.badge')?.remove();
  });
});

// ── Badge de notificação numa aba ──
function notifyTab(tabId) {
  const btn = document.querySelector(`[data-tab="${tabId}"]`);
  if (!btn || btn.classList.contains('active')) return;
  if (!btn.querySelector('.badge')) {
    const b = document.createElement('span');
    b.className = 'badge';
    b.textContent = '●';
    btn.appendChild(b);
  }
}

// ── Aba 1: Renderizar comandos ──
function renderLista(comandos, rewardMap) {
  const list = document.getElementById('command-list');
  if (!comandos?.length) {
    list.innerHTML = '<p class="no-commands">Este canal ainda não configurou comandos.<br>Volte em breve! 👀</p>';
    return;
  }
  list.innerHTML = comandos.map(c => {
    const pts = rewardMap?.[c.cmd];
    const ptsBadge = pts ? `<span class="cmd-pts">${pts.toLocaleString('pt-BR')} pts</span>` : '';
    return `
      <div class="command-item">
        <span class="cmd-name">${escHtml(c.emoji || '')} ${escHtml(c.cmd)}</span>
        <span class="cmd-meta">
          ${ptsBadge}
          <span class="cmd-user">${escHtml(c.desc || PERM_LABEL[c.perm] || '')}</span>
        </span>
      </div>
    `;
  }).join('');
}

// ── Aba 2: Canal info ──
function renderCanalInfo(data) {
  const el = id => document.getElementById(id);
  if (data.game)    el('canal-game').textContent  = data.game;
  if (data.title)   el('canal-title').textContent = data.title;
  if (data.viewers !== undefined) el('stat-viewers').textContent = fmtNum(data.viewers);
  if (data.subs !== undefined)    el('stat-subs').textContent    = fmtNum(data.subs);
  if (data.uptime)  el('stat-uptime').textContent = data.uptime;
}

// ── Aba 5: Recompensas de Channel Points ──
function renderRewards(rewards, rewardMap) {
  const list = document.getElementById('rewards-list');
  if (!rewards?.length) {
    list.innerHTML = '<p class="no-commands">Nenhuma recompensa configurada ainda.<br>Configure no painel do streamer. 🪙</p>';
    return;
  }

  // Mapeamento de efeito para emoji de preview
  const EFFECT_ICONS = {
    '!hype':'🔥','!hidrate':'💧','!alongar':'🧘','!skill':'💀','!lurk':'👻',
  };

  list.innerHTML = rewards.map(r => {
    const mappedEffect = rewardMap?.[r.id] || rewardMap?.[r.title];
    const effectBadge = mappedEffect
      ? `<span class="reward-effect-badge">${EFFECT_ICONS[mappedEffect] || '✨'} ${mappedEffect}</span>`
      : '';
    return `
      <div class="reward-item">
        <div class="reward-icon">${r.icon || '🪙'}</div>
        <div class="reward-info">
          <div class="reward-name">${escHtml(r.title)}</div>
          <div class="reward-cost">${(r.cost || 0).toLocaleString('pt-BR')}</div>
        </div>
        ${effectBadge}
      </div>
    `;
  }).join('');
}

// ── Role badge ──
function setRoleBadge(role) {
  const el = document.getElementById('role-badge');
  if (!el) return;
  const map = {
    broadcaster: { label: '🎮 Streamer', cls: 'mod' },
    moderator:   { label: '🔨 Mod',      cls: 'mod' },
    subscriber:  { label: '💜 Sub',      cls: 'sub' },
    vip:         { label: '⭐ VIP',      cls: 'vip' },
    viewer:      { label: '👁 Viewer',   cls: 'viewer' },
  };
  const def = map[role] || map.viewer;
  el.textContent = def.label;
  el.className = `role-badge ${def.cls}`;
}

// ── Conectar PubSub via broadcast do bot ──
function conectarPubSub(channelId) {
  TwitchExt.listen('broadcast', (target, contentType, raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      // Comandos de efeito (já existentes)
      case 'command':
        break;

      // Alertas do bot
      case 'sub':
        AlertSystem.onSub(msg.data || msg);
        notifyTab('tab-canal');
        break;
      case 'cheer':
        AlertSystem.onCheer(msg.data || msg);
        notifyTab('tab-canal');
        break;
      case 'raid':
        AlertSystem.onRaid(msg.data || msg);
        notifyTab('tab-canal');
        break;
      case 'channel_points':
        AlertSystem.onChannelPoints(msg.data || msg);
        notifyTab('tab-canal');
        break;

      // Hype Train
      case 'hype_train_start':
        if (extCfg.showAlerts) window.HypeTrain?.onStart(msg.data || msg);
        break;
      case 'hype_train_progress':
        window.HypeTrain?.onProgress(msg.data || msg);
        break;
      case 'hype_train_end':
        window.HypeTrain?.onEnd(msg.data || msg);
        break;

      // Polls
      case 'poll_create':
      case 'poll_update':
      case 'poll_complete':
        if (extCfg.showPolls) {
          PollsSystem.onPollEvent({ type: msg.type, data: msg.data || msg });
          notifyTab('tab-poll');
        }
        break;

      // Predictions
      case 'prediction_create':
      case 'prediction_progress':
      case 'prediction_lock':
      case 'event-ended':
        if (extCfg.showPredictions) {
          PollsSystem.onPredictionEvent({ type: msg.type, data: msg.data || msg });
          notifyTab('tab-pred');
        }
        break;

      // Canal info ao vivo
      case 'canal_info':
        renderCanalInfo(msg.data || msg);
        break;
    }
  });
}

// ── Carregar dados do backend ──
function carregar(channelId) {
  fetch(`${BACKEND}/api/extension/${channelId}/commands`)
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        const h = document.getElementById('panel-title-text');
        if (h && data.canal) h.textContent = data.canal;
        renderLista(data.commands, data.reward_map);
        renderRewards(data.rewards || [], data.reward_map);
        if (data.canal_info) renderCanalInfo(data.canal_info);
      } else {
        renderLista([]);
      }
    })
    .catch(() => {
      document.getElementById('command-list').innerHTML =
        '<p class="no-commands">Não foi possível carregar os comandos.</p>';
    });
}

// ── Inicializar ──
AlertSystem.setFeedContainer(document.getElementById('alert-feed'));
PollsSystem.setPollContainer(document.getElementById('poll-pane'));
PollsSystem.setPredContainer(document.getElementById('pred-pane'));

// Aplica config do broadcaster
const savedCfg = TwitchExt.getConfig('broadcaster');
if (savedCfg) extCfg = Object.assign(extCfg, savedCfg);
AlertSystem.setConfig({ showInPanel: extCfg.showAlerts });

TwitchExt.onAuthorized(auth => {
  carregar(auth.channelId);
  conectarPubSub(auth.channelId);

  // Role badge
  const viewer = TwitchExt.getViewer();
  setRoleBadge(viewer.role);
});

TwitchExt.onContext(ctx => {
  if (ctx.game) document.getElementById('canal-game').textContent = ctx.game;
});

// ── Helpers ──
function fmtNum(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}
function escHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );
}
