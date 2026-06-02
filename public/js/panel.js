// Painel da extensão — busca a lista de comandos do canal no backend e exibe.
const BACKEND = 'https://explorarbot.up.railway.app';

const PERM_LABEL = { todos:'Todos', subs:'Subs', vip:'VIP', mods:'Mods', broadcaster:'Streamer' };

function renderLista(comandos) {
  const list = document.getElementById('command-list');
  if (!comandos || comandos.length === 0) {
    list.innerHTML = '<p class="no-commands">Este canal ainda não configurou comandos.<br>Volte em breve! 👀</p>';
    return;
  }
  list.innerHTML = comandos.map(c => `
    <div class="command-item">
      <span class="cmd-name">${c.emoji} ${c.cmd}</span>
      <span class="cmd-user">${c.desc || PERM_LABEL[c.perm] || ''}</span>
    </div>
  `).join('');
}

function carregar(channelId) {
  fetch(`${BACKEND}/api/extension/${channelId}/commands`)
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        const h = document.querySelector('.panel-header h2');
        if (h && data.canal) h.textContent = 'Comandos · ' + data.canal;
        renderLista(data.commands);
      } else {
        renderLista([]);
      }
    })
    .catch(() => {
      document.getElementById('command-list').innerHTML =
        '<p class="no-commands">Não foi possível carregar os comandos.</p>';
    });
}

// Pega o ID do canal via Twitch helper
if (window.Twitch && window.Twitch.ext) {
  window.Twitch.ext.onAuthorized((auth) => {
    carregar(auth.channelId);
  });
} else {
  // Dev local
  carregar('131509204');
}
