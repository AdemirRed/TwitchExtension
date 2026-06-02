// video-component.js — lógica do componente de vídeo
let count = 0;
const lastCmd = document.getElementById('last-cmd');
const counter = document.getElementById('cmd-counter');
const EMOJIS  = { '!hidrate':'💧', '!alongar':'🧘', '!skill':'💀', '!hype':'🔥', '!lurk':'👻' };

TwitchExt.onAuthorized(() => {
  TwitchExt.listen('broadcast', (t, ct, msg) => {
    try {
      const d = JSON.parse(msg);
      if (d.type === 'command') {
        count++;
        const e = EMOJIS[d.cmd] || '❓';
        lastCmd.textContent = e + ' ' + d.cmd.toUpperCase();
        lastCmd.style.animation = 'none';
        void lastCmd.offsetWidth;
        lastCmd.style.animation = '';
        counter.textContent = count + ' comando' + (count !== 1 ? 's' : '') + ' usados';
      }
    } catch(e) {}
  });
});
