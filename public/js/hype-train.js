// ═══════════════════════════════════════════════════════════════
// hype-train.js — Barra de progresso do Hype Train
// Aparece no topo do overlay quando o hype train inicia.
// ═══════════════════════════════════════════════════════════════

window.HypeTrain = (function () {
  let bar   = null;
  let fill  = null;
  let badge = null;
  let hideTimer = null;

  function init() {
    bar   = document.getElementById('hype-train-bar');
    fill  = document.getElementById('hype-train-fill');
    badge = document.getElementById('hype-train-badge');
  }

  function show(level, progress, goal) {
    if (!bar) init();
    if (!bar) return;

    const pct = goal > 0 ? Math.min(100, (progress / goal) * 100) : 0;

    bar.classList.remove('hidden');
    badge.classList.remove('hidden');
    fill.style.width = pct + '%';
    badge.textContent = `🚂 HYPE TRAIN · Nível ${level} · ${Math.round(pct)}%`;

    // Auto-esconde se não receber mais eventos em 30s
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 30000);
  }

  function hide() {
    if (!bar) return;
    bar.classList.add('hidden');
    badge.classList.add('hidden');
  }

  function onStart(data) {
    // data: { total_points, goal, level, started_at }
    show(data.level || 1, data.total_points || 0, data.goal || 1);
  }

  function onProgress(data) {
    // data: { total_points, goal, level, contributions }
    show(data.level || 1, data.total_points || 0, data.goal || 1);
  }

  function onEnd(data) {
    // data: { ended_at, result: 'completed' | 'expired', level }
    if (!bar) return;
    if (data.result === 'completed') {
      fill.style.width = '100%';
      badge.textContent = `🎉 HYPE TRAIN COMPLETO! Nível ${data.level}`;
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, 5000);
    } else {
      hide();
    }
  }

  return { init, show, hide, onStart, onProgress, onEnd };
})();
