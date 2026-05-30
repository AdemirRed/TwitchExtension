// Comandos disponíveis (sync com config.js)
const COMMANDS = {
  '!hidrate':  { emoji: '💧', label: 'HIDRATE!',    color: '#1da1f2' },
  '!alongar':  { emoji: '🧘', label: 'ALONGAR!',    color: '#43b581' },
  '!skill':    { emoji: '💀', label: 'SKILL ISSO!', color: '#f04747' },
  '!lurk':     { emoji: '👻', label: 'LURK MODE',   color: '#747f8d' },
  '!hype':     { emoji: '🔥', label: 'HYPE!',       color: '#f4a020' },
};

const MAX_ITEMS = 8;
let history = [];

function renderList() {
  const list = document.getElementById('command-list');
  if (history.length === 0) {
    list.innerHTML = '<p class="no-commands">Nenhum comando ainda...<br>Use os comandos no chat!</p>';
    return;
  }
  list.innerHTML = history.slice().reverse().map(item => `
    <div class="command-item" style="border-left-color: ${item.color}">
      <span class="cmd-name">${item.emoji} ${item.cmd}</span>
      <span class="cmd-user">${item.user}</span>
    </div>
  `).join('');
}

function addCommand(cmd, user) {
  const info = COMMANDS[cmd] || { emoji: '❓', label: cmd, color: '#9147ff' };
  history.push({ cmd, user, emoji: info.emoji, color: info.color, ts: Date.now() });
  if (history.length > MAX_ITEMS) history.shift();
  renderList();
}

// PubSub: recebe eventos do streamer
TwitchExt.onAuthorized(() => {
  TwitchExt.listen('broadcast', (target, contentType, msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'command') {
        addCommand(data.cmd, data.user);
      }
    } catch (e) { /* ignora mensagens inválidas */ }
  });
});

// Botões de teste em modo local
if (TwitchExt.isLocal) {
  document.getElementById('dev-tools').style.display = 'block';
  Object.keys(COMMANDS).forEach(cmd => {
    const btn = document.createElement('button');
    btn.textContent = cmd;
    btn.onclick = () => addCommand(cmd, 'dev_user');
    document.getElementById('dev-buttons').appendChild(btn);
  });
}

renderList();
