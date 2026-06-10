// ═══════════════════════════════════════════════════════════════
// config.js — Página de configuração da extensão (broadcaster)
// Gerencia: toggles de features, mapeamento Channel Points → efeitos
// ═══════════════════════════════════════════════════════════════

const BACKEND = 'https://explorarbot.up.railway.app';

// Efeitos disponíveis para mapear
const AVAILABLE_EFFECTS = [
  { value: '', label: '— Sem efeito —' },
  { value: '!hype',    label: '🔥 !hype' },
  { value: '!hidrate', label: '💧 !hidrate' },
  { value: '!alongar', label: '🧘 !alongar' },
  { value: '!skill',   label: '💀 !skill' },
  { value: '!lurk',    label: '👻 !lurk' },
];

// Estado local dos mapeamentos
let rewardMappings = {}; // { rewardId: '!hype', ... }
let channelId = null;

// ── Carregar configuração salva ──
function loadConfig() {
  const saved = TwitchExt.getConfig('broadcaster');
  if (!saved) return;

  const toggles = {
    'cfg-alert-sub':   saved.alertSub   !== false,
    'cfg-alert-cheer': saved.alertCheer !== false,
    'cfg-alert-raid':  saved.alertRaid  !== false,
    'cfg-alert-pts':   saved.alertPts   !== false,
    'cfg-hype-train':  saved.hypeTrain  !== false,
    'cfg-show-polls':  saved.showPolls  !== false,
    'cfg-show-pred':   saved.showPred   !== false,
    'cfg-feed-panel':  saved.feedPanel  !== false,
  };

  Object.entries(toggles).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.checked = val;
  });

  if (saved.rewardMap) rewardMappings = saved.rewardMap;
}

// ── Carregar e renderizar recompensas do canal ──
function carregarRecompensas(chId) {
  const container = document.getElementById('reward-map-list');

  fetch(`${BACKEND}/api/extension/${chId}/rewards`)
    .then(r => r.json())
    .then(data => {
      const rewards = data.rewards || data || [];
      if (!rewards.length) {
        container.innerHTML = `
          <p style="font-size:11px;color:var(--text-muted)">
            Nenhuma recompensa de Channel Points encontrada.<br>
            Crie recompensas no painel do criador e elas aparecerão aqui.
          </p>`;
        return;
      }
      renderRewardMap(rewards);
    })
    .catch(() => {
      // Fallback dev: mostra recompensas fictícias
      renderRewardMap([
        { id: 'r1', title: 'Ativar Hype Especial', cost: 1500 },
        { id: 'r2', title: 'Lembrar de Hidratar',  cost: 500  },
        { id: 'r3', title: 'Alongar Geral',         cost: 800  },
      ]);
    });
}

function renderRewardMap(rewards) {
  const container = document.getElementById('reward-map-list');
  const optionsHtml = AVAILABLE_EFFECTS.map(e =>
    `<option value="${e.value}">${e.label}</option>`
  ).join('');

  container.innerHTML = rewards.map(r => `
    <div class="reward-map-item">
      <span class="reward-map-name" title="${escHtml(r.title)}">
        🪙 ${escHtml(r.title)}<br>
        <small style="color:var(--text-muted);font-size:9px">${(r.cost || 0).toLocaleString('pt-BR')} pts</small>
      </span>
      <select class="reward-map-select" id="map-${escId(r.id || r.title)}" data-reward-id="${escHtml(r.id || r.title)}">
        ${optionsHtml}
      </select>
    </div>
  `).join('');

  // Preencher valores salvos
  rewards.forEach(r => {
    const sel = document.getElementById(`map-${escId(r.id || r.title)}`);
    const saved = rewardMappings[r.id] || rewardMappings[r.title] || '';
    if (sel) sel.value = saved;
  });
}

// ── Salvar configuração ──
function salvarConfig() {
  // Coletar mapeamentos atuais
  document.querySelectorAll('[data-reward-id]').forEach(sel => {
    const rid = sel.dataset.rewardId;
    rewardMappings[rid] = sel.value;
  });

  const config = {
    alertSub:   document.getElementById('cfg-alert-sub')?.checked   !== false,
    alertCheer: document.getElementById('cfg-alert-cheer')?.checked !== false,
    alertRaid:  document.getElementById('cfg-alert-raid')?.checked  !== false,
    alertPts:   document.getElementById('cfg-alert-pts')?.checked   !== false,
    hypeTrain:  document.getElementById('cfg-hype-train')?.checked  !== false,
    showPolls:  document.getElementById('cfg-show-polls')?.checked  !== false,
    showPred:   document.getElementById('cfg-show-pred')?.checked   !== false,
    feedPanel:  document.getElementById('cfg-feed-panel')?.checked  !== false,
    rewardMap:  rewardMappings,
  };

  TwitchExt.setConfig('broadcaster', '1.0', JSON.stringify(config));

  // Feedback visual
  const status = document.getElementById('save-status');
  const btn    = document.getElementById('save-btn');
  btn.textContent = '✅ Salvo!';
  status.textContent = 'Configurações aplicadas com sucesso!';
  setTimeout(() => {
    btn.textContent = '💾 Salvar Configurações';
    status.textContent = '';
  }, 3000);
}

// ── Helpers ──
function escHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );
}
function escId(str) {
  return String(str || '').replace(/[^a-z0-9]/gi, '_');
}

// ── Init ──
TwitchExt.onAuthorized(auth => {
  channelId = auth.channelId;
  loadConfig();
  carregarRecompensas(channelId);
});
