const DEFAULTS = {
  cmd_hidrate: true,
  cmd_alongar: true,
  cmd_skill:   true,
  cmd_lurk:    true,
  cmd_hype:    true,
  overlay_efeitos: true,
  cooldown_segundos: 30,
};

let settings = { ...DEFAULTS };

function loadSettings() {
  const saved = TwitchExt.getConfiguration('broadcaster');
  if (saved && saved.content) {
    try { settings = { ...DEFAULTS, ...JSON.parse(saved.content) }; } catch (e) { /* usa padrão */ }
  }
  applyToForm();
}

function applyToForm() {
  Object.keys(settings).forEach(key => {
    const el = document.getElementById(key);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = settings[key];
    else el.value = settings[key];
  });
}

function saveSettings() {
  document.querySelectorAll('[data-setting]').forEach(el => {
    const key = el.dataset.setting;
    settings[key] = el.type === 'checkbox' ? el.checked : el.value;
  });

  TwitchExt.configuration('broadcaster', '1.0', JSON.stringify(settings));

  const btn = document.getElementById('save-btn');
  btn.textContent = 'Salvo!';
  btn.style.background = '#43b581';
  setTimeout(() => { btn.textContent = 'Salvar configurações'; btn.style.background = ''; }, 2000);
}

TwitchExt.onAuthorized(loadSettings);

document.getElementById('save-btn').addEventListener('click', saveSettings);
