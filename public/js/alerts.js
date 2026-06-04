// ═══════════════════════════════════════════════════════════════
// alerts.js — Sistema centralizado de alertas do ExplorarBot
// Gerencia: Sub, Resub, GiftSub, Cheer, Raid, Channel Points
// Os alertas são configuráveis via config da extensão.
// ═══════════════════════════════════════════════════════════════

window.AlertSystem = (function () {
  // ── Config padrão (pode ser sobrescrita pela config do broadcaster) ──
  let cfg = {
    showInOverlay: true,
    showInPanel:   true,
    showInMobile:  true,
    alertDuration: 5000, // ms
  };

  // ── Feed no painel (lista de alertas recentes) ──
  const MAX_FEED = 5;
  const feedItems = [];
  let feedContainer = null; // será setado pelo panel.js

  function setConfig(newCfg) {
    cfg = Object.assign(cfg, newCfg);
  }

  function setFeedContainer(el) {
    feedContainer = el;
  }

  // ── Definições visuais por tipo ──
  const ALERT_DEFS = {
    sub:   { icon: '💜', type: 'NOVO SUB',    className: 'sub'   },
    resub: { icon: '💜', type: 'RESUB',        className: 'resub' },
    gift:  { icon: '🎁', type: 'GIFT SUB',     className: 'gift'  },
    cheer: { icon: '💎', type: 'CHEER',        className: 'cheer' },
    raid:  { icon: '🚀', type: 'RAID!',        className: 'raid'  },
    pts:   { icon: '🪙', type: 'CHANNEL PTS',  className: 'pts'   },
  };

  // ── Adiciona ao feed do painel ──
  function addToFeed(type, user, detail) {
    if (!feedContainer) return;
    const def = ALERT_DEFS[type] || ALERT_DEFS.sub;
    const item = document.createElement('div');
    item.className = `alert-feed-item ${def.className}`;
    item.innerHTML = `
      <span>${def.icon}</span>
      <span class="af-user">${escHtml(user)}</span>
      <span class="af-msg">${escHtml(detail || '')}</span>
    `;
    feedContainer.prepend(item);
    feedItems.push(item);
    if (feedItems.length > MAX_FEED) {
      feedItems.shift()?.remove();
    }
  }

  // ── Cria toast no overlay ──
  function showOverlayToast(type, user, detail, message) {
    const stack = document.getElementById('alert-stack');
    if (!stack) return;

    const def = ALERT_DEFS[type] || ALERT_DEFS.sub;
    const toast = document.createElement('div');
    toast.className = `alert-toast ${def.className}`;
    toast.innerHTML = `
      <div class="alert-icon">${def.icon}</div>
      <div class="alert-body">
        <div class="alert-type">${def.type}</div>
        <div class="alert-user">${escHtml(user)}</div>
        ${detail ? `<div class="alert-detail">${escHtml(detail)}</div>` : ''}
        ${message ? `<div class="alert-msg">"${escHtml(message)}"</div>` : ''}
      </div>
    `;
    stack.appendChild(toast);

    // Remove após animação (4.6s fadeOut + 0.5s buffer)
    setTimeout(() => toast.remove(), (cfg.alertDuration || 5000) + 500);
  }

  // ── Dispatch principal ──
  function dispatch(type, payload) {
    const { user, detail, message } = payload;

    if (cfg.showInOverlay) showOverlayToast(type, user, detail, message);
    if (cfg.showInPanel)   addToFeed(type, user, detail);

    // Vibração no mobile (se suportado)
    if (cfg.showInMobile && navigator.vibrate) {
      if (type === 'raid') navigator.vibrate([200, 100, 200]);
      else navigator.vibrate(80);
    }
  }

  // ── API pública ──
  function onSub(data) {
    // data: { user_name, cumulative_months, sub_plan, is_gift, gifter_login, streak_months }
    if (data.is_gift) {
      dispatch('gift', {
        user: data.gifter_login || 'Alguém',
        detail: `presenteou ${data.user_name} (Tier ${data.sub_plan?.[0] || '1'})`,
      });
    } else if (data.cumulative_months > 1) {
      dispatch('resub', {
        user: data.user_name,
        detail: `${data.cumulative_months} meses consecutivos!`,
        message: data.sub_message?.message,
      });
    } else {
      dispatch('sub', {
        user: data.user_name,
        detail: `se inscreveu! (Tier ${data.sub_plan?.[0] || '1'})`,
      });
    }
  }

  function onCheer(data) {
    // data: { user_name, bits_used, total_bits_used, chat_message }
    dispatch('cheer', {
      user: data.user_name || 'Anon',
      detail: `${data.bits_used} bits`,
      message: data.chat_message,
    });
    // Spawna confetti dourado
    spawnConfetti(['#f4a020', '#ffd700', '#fff', '#ff6d00']);
  }

  function onRaid(data) {
    // data: { raider_name, viewer_count }
    dispatch('raid', {
      user: data.raider_name,
      detail: `chegou com ${data.viewer_count} pessoas!`,
    });
    spawnConfetti(['#f04747', '#ff8080', '#fff', '#9147ff']);
  }

  function onChannelPoints(data) {
    // data: { reward: { title, cost, id }, user_name, user_input }
    const reward = data.reward || {};
    dispatch('pts', {
      user: data.user_name,
      detail: `${reward.title || 'Recompensa'} (${(reward.cost || 0).toLocaleString('pt-BR')} pts)`,
      message: data.user_input || undefined,
    });
    // Mostra banner de pts no overlay
    showPtsBanner(data.user_name, reward.title, reward.cost);
  }

  function showPtsBanner(user, rewardTitle, cost) {
    const existing = document.querySelector('.pts-redeem-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.className = 'pts-redeem-banner';
    banner.innerHTML = `
      <div class="pts-coin">🪙</div>
      <div class="pts-info">
        <div class="pts-who">${escHtml(user)}</div>
        <div class="pts-what">${escHtml(rewardTitle || 'Recompensa')}${cost ? ` · ${cost.toLocaleString('pt-BR')} pts` : ''}</div>
      </div>
    `;
    const overlay = document.querySelector('.overlay-container') || document.body;
    overlay.appendChild(banner);
    setTimeout(() => banner.remove(), 5200);
  }

  // ── Confetti ──
  function spawnConfetti(colors) {
    const layer = document.getElementById('effect-layer') || document.body;
    for (let i = 0; i < 50; i++) {
      const el = document.createElement('div');
      el.className = 'confetti-piece';
      el.style.left = Math.random() * 100 + 'vw';
      el.style.background = colors[Math.floor(Math.random() * colors.length)];
      el.style.animationDuration = (2 + Math.random() * 2) + 's';
      el.style.animationDelay = Math.random() * 0.4 + 's';
      el.style.transform = `rotate(${Math.random() * 360}deg)`;
      layer.appendChild(el);
      el.addEventListener('animationend', () => el.remove());
    }
  }

  // ── Helper ──
  function escHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
    );
  }

  return { setConfig, setFeedContainer, onSub, onCheer, onRaid, onChannelPoints, spawnConfetti };
})();
