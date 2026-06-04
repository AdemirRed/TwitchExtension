// ═══════════════════════════════════════════════════════════════
// twitch-ext.js — Wrapper completo do Twitch Extension Helper
// Inclui: auth, context, PubSub, config, viewer, visibility
// ═══════════════════════════════════════════════════════════════
window.TwitchExt = (function () {
  const isLocal = window.location.hostname === 'localhost' ||
                  window.location.protocol === 'file:';

  // Estado simulado para dev local
  const mockState = {
    channelId: '131509204',
    userId: 'local_user_42',
    role: 'viewer',  // troque para 'subscriber', 'moderator' etc p/ testar
    config: {},
    context: { theme: 'dark', language: 'pt-BR', game: 'Just Chatting', isFullScreen: false },
  };

  /* ── Auth ── */
  function onAuthorized(cb) {
    if (window.Twitch?.ext) {
      window.Twitch.ext.onAuthorized(cb);
    } else {
      setTimeout(() => cb({
        channelId: mockState.channelId,
        userId: mockState.userId,
        role: mockState.role,
        token: 'dev_token_mock',
      }), 300);
    }
  }

  /* ── Context ── */
  function onContext(cb) {
    if (window.Twitch?.ext) {
      window.Twitch.ext.onContext(cb);
    } else {
      setTimeout(() => cb(mockState.context), 300);
    }
  }

  /* ── Viewer ── */
  function getViewer() {
    if (window.Twitch?.ext?.viewer) return window.Twitch.ext.viewer;
    return {
      id: mockState.userId,
      role: mockState.role,           // 'viewer' | 'subscriber' | 'moderator' | 'broadcaster'
      isSubscribed: mockState.role === 'subscriber' || mockState.role === 'broadcaster',
    };
  }

  /* ── PubSub ── */
  function listen(target, cb) {
    if (window.Twitch?.ext) {
      window.Twitch.ext.listen(target, cb);
    } else {
      console.log('[DevMode] PubSub listen registrado para:', target);
    }
  }

  function send(target, contentType, message) {
    if (window.Twitch?.ext) {
      window.Twitch.ext.send(target, contentType, message);
    } else {
      console.log('[DevMode] PubSub send:', target, message);
    }
  }

  /* ── Configuration ── */
  function setConfig(segment, version, content) {
    if (window.Twitch?.ext) {
      window.Twitch.ext.configuration.set(segment, version, content);
    } else {
      mockState.config[segment] = content;
      console.log('[DevMode] Config salva:', segment, content);
    }
  }

  function getConfig(segment) {
    if (window.Twitch?.ext?.configuration?.[segment]?.content) {
      try { return JSON.parse(window.Twitch.ext.configuration[segment].content); }
      catch { return null; }
    }
    if (mockState.config[segment]) {
      try { return JSON.parse(mockState.config[segment]); }
      catch { return mockState.config[segment]; }
    }
    return null;
  }

  function onConfigChanged(cb) {
    if (window.Twitch?.ext) {
      window.Twitch.ext.configuration.onChanged(cb);
    } else {
      console.log('[DevMode] onConfigChanged registrado');
    }
  }

  /* ── Visibility ── */
  function onVisibilityChanged(cb) {
    if (window.Twitch?.ext) {
      window.Twitch.ext.onVisibilityChanged(cb);
    } else {
      // Simula visível no dev
      setTimeout(() => cb(true, null), 500);
    }
  }

  /* ── Ações de extensão (botão de seguir, etc) ── */
  function actions_followChannel(channelName) {
    if (window.Twitch?.ext?.actions) {
      window.Twitch.ext.actions.followChannel(channelName);
    }
  }

  return {
    isLocal,
    onAuthorized,
    onContext,
    getViewer,
    listen,
    send,
    setConfig,
    getConfig,
    onConfigChanged,
    onVisibilityChanged,
    actions_followChannel,
  };
})();
