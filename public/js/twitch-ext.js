// Wrapper do Twitch Extension Helper com fallback para desenvolvimento local
window.TwitchExt = (function () {
  const isLocal = window.location.hostname === 'localhost';

  // Estado simulado para dev local
  const mockState = {
    channelId: 'local_dev_channel',
    userId: null,
    role: 'viewer',
    config: {},
  };

  function onAuthorized(cb) {
    if (window.Twitch && window.Twitch.ext) {
      window.Twitch.ext.onAuthorized(cb);
    } else {
      // Simula auth para testes locais
      setTimeout(() => cb({ channelId: mockState.channelId, userId: 'local_user', token: 'dev_token' }), 300);
    }
  }

  function onContext(cb) {
    if (window.Twitch && window.Twitch.ext) {
      window.Twitch.ext.onContext(cb);
    } else {
      setTimeout(() => cb({ theme: 'dark', language: 'pt-BR', game: 'Just Chatting' }), 300);
    }
  }

  function listen(target, cb) {
    if (window.Twitch && window.Twitch.ext) {
      window.Twitch.ext.listen(target, cb);
    } else {
      console.log('[DevMode] PubSub listen registrado para:', target);
    }
  }

  function send(target, contentType, message) {
    if (window.Twitch && window.Twitch.ext) {
      window.Twitch.ext.send(target, contentType, message);
    } else {
      console.log('[DevMode] PubSub send:', target, message);
    }
  }

  function configuration(segment, version, content) {
    if (window.Twitch && window.Twitch.ext) {
      window.Twitch.ext.configuration.set(segment, version, content);
    } else {
      mockState.config[segment] = content;
      console.log('[DevMode] Config salva:', segment, content);
    }
  }

  function getConfiguration(segment) {
    if (window.Twitch && window.Twitch.ext && window.Twitch.ext.configuration[segment]) {
      return window.Twitch.ext.configuration[segment];
    }
    return mockState.config[segment] || null;
  }

  return { onAuthorized, onContext, listen, send, configuration, getConfiguration, isLocal };
})();
