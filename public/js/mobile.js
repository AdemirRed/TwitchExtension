// mobile.js — lógica do painel mobile
const CMDS = [
  { cmd: '!hidrate', icon: '💧', desc: 'Lembrar de beber água' },
  { cmd: '!alongar', icon: '🧘', desc: 'Hora de se alongar' },
  { cmd: '!skill',   icon: '💀', desc: 'Culpar a skill' },
  { cmd: '!hype',    icon: '🔥', desc: 'Hype na chat!' },
  { cmd: '!lurk',    icon: '👻', desc: 'Entrar em modo lurk' },
];

const grid  = document.getElementById('cmd-grid');
const toast = document.getElementById('toast');
let toastTimer;

function showToast(msg) {
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}

let auth = null;
TwitchExt.onAuthorized(a => { auth = a; });

CMDS.forEach(({ cmd, icon, desc }) => {
  const card = document.createElement('div');
  card.className = 'cmd-card';
  card.innerHTML = `<span class="icon">${icon}</span><div class="name">${cmd}</div><div class="desc">${desc}</div>`;
  card.onclick = () => {
    showToast(icon + ' ' + cmd + ' enviado!');
    TwitchExt.send('broadcast', 'application/json', JSON.stringify({ type: 'command', cmd, user: auth?.userId || 'mobile_user' }));
  };
  grid.appendChild(card);
});
