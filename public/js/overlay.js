// ═══════════════════════════════════════════════════════════════
// overlay.js — Efeitos visuais no overlay de vídeo
// Integra: efeitos de comandos, alertas, hype train
// ═══════════════════════════════════════════════════════════════

// ── Mapa de efeitos de comandos de chat ──
const EFFECTS = {
  '!hidrate': { text: '💧 HIDRATE!',    bg: 'rgba(29,161,242,0.12)',  confetti: false },
  '!alongar': { text: '🧘 ALONGAR!',    bg: 'rgba(67,181,129,0.12)',  confetti: false },
  '!skill':   { text: '💀 SKILL ISSO!', bg: 'rgba(240,71,71,0.12)',   confetti: false },
  '!hype':    { text: '🔥 HYPE!',       bg: 'rgba(244,160,32,0.12)',  confetti: true  },
  '!lurk':    { text: '👻 FOI DE LURK', bg: 'rgba(114,137,218,0.12)', confetti: false },
};

// Recompensas de Channel Points mapeadas para efeitos
// (preenchido pela config do broadcaster)
let REWARD_EFFECTS = {};

const effectText = document.getElementById('effect-text');
let hideTimer = null;

// ── Config do broadcaster ──
const savedCfg = TwitchExt.getConfig('broadcaster');
if (savedCfg?.rewardMap)  REWARD_EFFECTS = savedCfg.rewardMap;
if (savedCfg?.alertsCfg)  AlertSystem.setConfig(savedCfg.alertsCfg);

// ── Efeito central (comando de chat) ──
function showEffect(cmd) {
  const fx = EFFECTS[cmd];
  if (!fx) return;

  if (hideTimer) clearTimeout(hideTimer);
  document.body.style.background = fx.bg;
  effectText.textContent = fx.text;
  effectText.className = 'effect-text visible';

  if (fx.confetti) AlertSystem.spawnConfetti(['#9147ff','#f0e6ff','#f4a020','#43b581','#f04747']);

  hideTimer = setTimeout(() => {
    effectText.className = 'effect-text';
    document.body.style.background = 'transparent';
  }, 3000);
}

// ── Canal Points → efeito ──
function handleChannelPoints(data) {
  AlertSystem.onChannelPoints(data);

  // Verifica se esta recompensa tem um efeito mapeado
  const rewardId    = data.reward?.id || '';
  const rewardTitle = data.reward?.title || '';
  const cmd = REWARD_EFFECTS[rewardId] || REWARD_EFFECTS[rewardTitle];
  if (cmd) showEffect(cmd);
}

// ── PubSub listener ──
TwitchExt.onAuthorized(() => {
  TwitchExt.listen('broadcast', (target, contentType, raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'command':
        showEffect(msg.cmd);
        break;
      case 'sub':
        AlertSystem.onSub(msg.data || msg);
        break;
      case 'cheer':
        AlertSystem.onCheer(msg.data || msg);
        break;
      case 'raid':
        AlertSystem.onRaid(msg.data || msg);
        break;
      case 'channel_points':
        handleChannelPoints(msg.data || msg);
        break;
      case 'hype_train_start':
        HypeTrain.onStart(msg.data || msg);
        break;
      case 'hype_train_progress':
        HypeTrain.onProgress(msg.data || msg);
        break;
      case 'hype_train_end':
        HypeTrain.onEnd(msg.data || msg);
        break;
    }
  });
});

// ── Dev: botões de teste ──
if (TwitchExt.isLocal) {
  const devTools = document.getElementById('dev-tools');
  devTools.style.display = 'flex';

  // Teste de comandos de chat
  const p = new URLSearchParams(window.location.search);
  if (p.get('cmd')) showEffect(p.get('cmd'));

  devTools.querySelectorAll('[data-cmd]').forEach(btn => {
    btn.onclick = () => showEffect(btn.dataset.cmd);
  });

  // Teste de alertas
  const DEV_ALERTS = {
    sub:   () => AlertSystem.onSub({ user_name: 'CoolViewer42', cumulative_months: 1, sub_plan: '1000' }),
    resub: () => AlertSystem.onSub({ user_name: 'FielSub99', cumulative_months: 7, sub_plan: '1000', sub_message: { message: 'Mês 7! Vamos!!' } }),
    gift:  () => AlertSystem.onSub({ user_name: 'Bot', gifter_login: 'GiftKing', is_gift: true, sub_plan: '1000' }),
    cheer: () => AlertSystem.onCheer({ user_name: 'BitMaster', bits_used: 500, chat_message: 'CHEER500 Let\'s go!' }),
    raid:  () => AlertSystem.onRaid({ raider_name: 'StreamRaider', viewer_count: 87 }),
    pts:   () => AlertSystem.onChannelPoints({ user_name: 'PointsUser', reward: { title: '!hype especial', cost: 1500, id: 'dev-reward-1' }, user_input: '' }),
  };

  devTools.querySelectorAll('[data-alert]').forEach(btn => {
    btn.onclick = () => DEV_ALERTS[btn.dataset.alert]?.();
  });

  // Teste de Hype Train
  let hypeLevel = 1;
  let hypeProg  = 0;
  devTools.querySelectorAll('[data-hype]').forEach(btn => {
    btn.onclick = () => {
      const action = btn.dataset.hype;
      if (action === 'start') {
        hypeLevel = 1; hypeProg = 200;
        HypeTrain.onStart({ level: 1, total_points: 200, goal: 1000 });
      } else if (action === 'progress') {
        hypeProg += 300;
        HypeTrain.onProgress({ level: hypeLevel, total_points: hypeProg, goal: 1000 });
        if (hypeProg >= 1000) { hypeLevel++; hypeProg = 0; }
      } else if (action === 'end') {
        HypeTrain.onEnd({ result: 'completed', level: hypeLevel });
      }
    };
  });
}
