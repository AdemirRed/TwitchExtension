// ═══════════════════════════════════════════════════════════════
// polls.js — Exibição ao vivo de Enquetes e Predictions
// Modo: só leitura. Criação permanece no site ExplorarBot.
// ═══════════════════════════════════════════════════════════════

window.PollsSystem = (function () {

  /* ──────────────── POLLS ──────────────── */

  let pollData = null;
  let pollTimer = null;
  let pollContainer = null; // elemento #poll-pane no panel
  let miniPollEl = null;    // elemento no mobile

  function setPollContainer(el) { pollContainer = el; }
  function setMiniPollEl(el)    { miniPollEl = el; }

  function calcPct(votes, total) {
    if (!total) return 0;
    return Math.round((votes / total) * 100);
  }

  function renderPoll(data) {
    // data: { title, choices: [{title, votes}], status, ends_at, duration_seconds }
    if (!pollContainer) return;

    const total = data.choices.reduce((s, c) => s + (c.votes || 0), 0);
    const maxVotes = Math.max(...data.choices.map(c => c.votes || 0), 1);
    const ended = data.status === 'COMPLETED' || data.status === 'TERMINATED';

    const secsLeft = data.ends_at
      ? Math.max(0, Math.round((new Date(data.ends_at) - Date.now()) / 1000))
      : null;

    const optionsHtml = data.choices.map((c, i) => {
      const pct = calcPct(c.votes || 0, total);
      const isLeading = (c.votes || 0) === maxVotes && total > 0;
      return `
        <div class="poll-option">
          <div class="poll-option-label">
            <span>${escHtml(c.title)}</span>
            <span class="pct">${pct}%</span>
          </div>
          <div class="poll-bar-bg">
            <div class="poll-bar-fill${isLeading ? ' leading' : ''}" style="width:${pct}%"></div>
          </div>
        </div>
      `;
    }).join('');

    pollContainer.innerHTML = `
      <div class="poll-card${ended ? ' poll-ended' : ''}">
        <div class="poll-title">🗳️ ${escHtml(data.title)}</div>
        ${optionsHtml}
        <div class="poll-timer">
          ${ended
            ? `✅ Encerrada · ${total.toLocaleString('pt-BR')} votos`
            : secsLeft !== null ? `⏱ ${secsLeft}s · ${total.toLocaleString('pt-BR')} votos` : ''
          }
        </div>
      </div>
    `;

    // Mini poll no mobile
    renderMiniPoll(data, total, maxVotes, ended);
  }

  function renderMiniPoll(data, total, maxVotes, ended) {
    if (!miniPollEl) return;
    const optHtml = data.choices.map(c => {
      const pct = calcPct(c.votes || 0, total);
      const isLeading = (c.votes || 0) === maxVotes && total > 0;
      return `
        <div class="mini-poll-opt">
          <span class="mini-poll-opt-label">${escHtml(c.title)}</span>
          <div class="mini-poll-bar-bg">
            <div class="mini-poll-bar-fill${isLeading ? ' leading' : ''}" style="width:${pct}%"></div>
          </div>
          <span class="mini-poll-pct${isLeading ? ' leading' : ''}">${pct}%</span>
        </div>
      `;
    }).join('');
    miniPollEl.innerHTML = `
      <div class="mini-poll">
        <div class="mini-poll-title">🗳️ ${escHtml(data.title)}</div>
        ${optHtml}
      </div>
    `;
    miniPollEl.style.display = 'block';
  }

  function clearPoll() {
    if (pollContainer) pollContainer.innerHTML = `<p class="no-poll">Nenhuma enquete ativa no momento.</p>`;
    if (miniPollEl) miniPollEl.style.display = 'none';
  }

  function onPollEvent(eventData) {
    // eventData: { type: 'poll-create'|'poll-update'|'poll-complete', data: {...} }
    if (!eventData?.data) return;
    pollData = eventData.data;

    if (eventData.type === 'poll-complete' || eventData.type === 'poll-terminate') {
      renderPoll({ ...pollData, status: 'COMPLETED' });
      clearTimeout(pollTimer);
      pollTimer = setTimeout(clearPoll, 15000); // remove após 15s
    } else {
      renderPoll(pollData);
    }
  }

  /* ──────────────── PREDICTIONS ──────────────── */

  let predContainer = null;

  function setPredContainer(el) { predContainer = el; }

  function renderPrediction(data) {
    if (!predContainer) return;
    // data: { title, outcomes: [{title, channel_points, channel_points_used_for_predictions, top_predictors, color}], status, locked_at }

    const outcomes = data.outcomes || [];
    const totalPts = outcomes.reduce((s, o) => s + (o.channel_points || 0), 0);

    const getColor = (o) => {
      const c = (o.color || '').toLowerCase();
      return c === 'pink' ? 'pink' : 'blue';
    };

    const optHtml = outcomes.map(o => {
      const pct = totalPts > 0 ? Math.round((o.channel_points / totalPts) * 100) : 50;
      const cls = getColor(o);
      return `
        <div class="pred-option ${cls}">
          <div class="pred-name">${escHtml(o.title)}</div>
          <div class="pred-pts">${(o.channel_points || 0).toLocaleString('pt-BR')} pts</div>
          <div class="pred-pct">${pct}%</div>
        </div>
      `;
    }).join('');

    const statusLabel = data.status === 'LOCKED'
      ? '🔒 Bloqueada'
      : data.status === 'RESOLVED'
      ? '✅ Resolvida'
      : '🔮 Ativa';

    predContainer.innerHTML = `
      <div class="pred-card">
        <div class="pred-title">🔮 ${escHtml(data.title)}</div>
        <div class="pred-options">${optHtml}</div>
        <div class="poll-timer" style="margin-top:6px">${statusLabel} · ${totalPts.toLocaleString('pt-BR')} pts totais</div>
      </div>
    `;
  }

  function clearPrediction() {
    if (predContainer) predContainer.innerHTML = `<p class="no-poll">Nenhuma previsão ativa no momento.</p>`;
  }

  function onPredictionEvent(eventData) {
    if (!eventData?.data) return;
    if (eventData.type === 'event-ended') {
      renderPrediction({ ...eventData.data, status: 'RESOLVED' });
      setTimeout(clearPrediction, 20000);
    } else {
      renderPrediction(eventData.data);
    }
  }

  /* ── Helper ── */
  function escHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
    );
  }

  return {
    setPollContainer, setMiniPollEl, onPollEvent, clearPoll,
    setPredContainer, onPredictionEvent, clearPrediction,
  };
})();
