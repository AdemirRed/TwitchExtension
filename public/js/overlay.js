const EFFECTS = {
  '!hidrate':  { text: '💧 HIDRATE!',    bg: 'rgba(29,161,242,0.15)',  confetti: false },
  '!alongar':  { text: '🧘 ALONGAR!',    bg: 'rgba(67,181,129,0.15)',  confetti: false },
  '!skill':    { text: '💀 SKILL ISSO!', bg: 'rgba(240,71,71,0.15)',   confetti: false },
  '!hype':     { text: '🔥 HYPE!',       bg: 'rgba(244,160,32,0.15)',  confetti: true  },
  '!lurk':     { text: '👻 FOI DE LURK', bg: 'rgba(114,137,218,0.15)', confetti: false },
};

const effectLayer = document.getElementById('effect-layer');
const effectText  = document.getElementById('effect-text');
let hideTimer = null;

function showEffect(cmd) {
  const fx = EFFECTS[cmd];
  if (!fx) return;

  if (hideTimer) clearTimeout(hideTimer);

  document.body.style.background = fx.bg;
  effectText.textContent = fx.text;
  effectText.className = 'effect-text visible';

  if (fx.confetti) spawnConfetti();

  hideTimer = setTimeout(() => {
    effectText.className = 'effect-text';
    document.body.style.background = 'transparent';
  }, 3000);
}

function spawnConfetti() {
  const colors = ['#9147ff', '#f0e6ff', '#f4a020', '#43b581', '#f04747'];
  for (let i = 0; i < 60; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    el.style.left = Math.random() * 100 + 'vw';
    el.style.background = colors[Math.floor(Math.random() * colors.length)];
    el.style.animationDuration = (2 + Math.random() * 2) + 's';
    el.style.animationDelay = Math.random() * 0.5 + 's';
    el.style.transform = `rotate(${Math.random() * 360}deg)`;
    effectLayer.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }
}

TwitchExt.onAuthorized(() => {
  TwitchExt.listen('broadcast', (target, contentType, msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'command') showEffect(data.cmd);
    } catch (e) { /* ignora */ }
  });
});

// Dev: teste via URL ?cmd=!hype
if (TwitchExt.isLocal) {
  const p = new URLSearchParams(window.location.search);
  if (p.get('cmd')) showEffect(p.get('cmd'));

  document.querySelectorAll('[data-cmd]').forEach(btn => {
    btn.onclick = () => showEffect(btn.dataset.cmd);
  });
  document.getElementById('dev-tools').style.display = 'flex';
}
