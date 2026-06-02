require('dotenv').config();
const express   = require('express');
const session   = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const fetch     = require('node-fetch');
const path      = require('path');
const http      = require('http');
const { Pool }  = require('pg');
const db        = require('./db');
const bot       = require('./bot');
const cmd       = require('./commands');
const asaas     = require('./asaas');

const app        = express();
const PORT       = process.env.PORT || 8080;
const BASE_URL   = process.env.BASE_URL || `http://localhost:${PORT}`;
const CLIENT_ID  = process.env.TWITCH_CLIENT_ID;
const CLIENT_SEC = process.env.TWITCH_CLIENT_SECRET;
const REDIRECT   = `${BASE_URL}/auth/callback`;

const SCOPES = [
  'chat:read','chat:edit',
  'moderator:manage:banned_users','moderator:read:chatters',
  'channel:manage:broadcast','clips:edit','user:read:broadcast',
  'moderator:manage:shoutouts','channel:manage:polls',
  'channel:read:polls','channel:manage:predictions','channel:read:predictions',
].join(' ');

// ── Middleware ────────────────────────────────────────────────────────────────

// Railway/Render terminam o HTTPS na borda e entregam HTTP pro app.
// Sem trust proxy, o Express acha que não é seguro e recusa o cookie secure
// → a sessão some após o login. Esta linha resolve.
app.set('trust proxy', 1);

// Pool separado para a session store (evita conflito com o pool principal)
const sessionPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/admin-assets', express.static(path.join(__dirname, 'admin')));
app.use(session({
  store: new PgSession({
    pool: sessionPool,
    tableName: 'sessions',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || 'dev-secret-troque-em-producao',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: BASE_URL.startsWith('https'),
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 dias — persiste entre restarts
  },
}));

function autenticado(req, res, next) {
  if (req.session?.streamer) return next();
  res.redirect('/?erro=login');
}

// ── Rotas públicas ────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/entrar', (req, res) => {
  const url = `https://id.twitch.tv/oauth2/authorize?client_id=${CLIENT_ID}`
    + `&redirect_uri=${encodeURIComponent(REDIRECT)}`
    + `&response_type=code&scope=${encodeURIComponent(SCOPES)}&force_verify=true`;
  res.redirect(url);
});

// Setup do bot — você acessa UMA vez logado na conta do BOT.
// Protegido por uma chave secreta na URL: /setup-bot?key=SESSION_SECRET
app.get('/setup-bot', (req, res) => {
  if (req.query.key !== process.env.SESSION_SECRET) {
    return res.status(403).send('Chave inválida. Use /setup-bot?key=SUA_SESSION_SECRET');
  }
  const url = `https://id.twitch.tv/oauth2/authorize?client_id=${CLIENT_ID}`
    + `&redirect_uri=${encodeURIComponent(REDIRECT)}`
    + `&response_type=code&scope=${encodeURIComponent('chat:read chat:edit')}`
    + `&state=bot&force_verify=true`;
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  const { code, error, state } = req.query;
  if (error || !code) return res.redirect('/?erro=cancelado');

  try {
    // Troca código por token
    const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID, client_secret: CLIENT_SEC,
        code, grant_type: 'authorization_code', redirect_uri: REDIRECT,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.redirect('/?erro=token');

    // Busca dados do usuário
    const userRes = await fetch('https://api.twitch.tv/helix/users', {
      headers: { 'Client-Id': CLIENT_ID, 'Authorization': `Bearer ${tokenData.access_token}` },
    });
    const userData = await userRes.json();
    const user = userData.data?.[0];
    if (!user) return res.redirect('/?erro=usuario');

    // ── Setup do BOT: guarda tokens do bot que vão se renovar sozinhos ──────
    if (state === 'bot') {
      await db.setConfig('bot_username', user.login);
      await db.setConfig('bot_access_token', tokenData.access_token);
      await db.setConfig('bot_refresh_token', tokenData.refresh_token || '');
      console.log(`[BOT] Conta configurada: ${user.login}. Reiniciando conexão...`);
      // Reinicia o bot com as novas credenciais
      bot.start().catch(e => console.error('[BOT] erro ao iniciar:', e.message));
      return res.send(`
        <body style="font-family:sans-serif;background:#18181b;color:#efeff1;text-align:center;padding:60px">
          <h1 style="color:#9147ff">✅ Bot configurado!</h1>
          <p>Conta do bot: <b>${user.login}</b></p>
          <p>O token vai se renovar sozinho. Não precisa mexer nunca mais.</p>
          <a href="/" style="color:#9147ff">Voltar ao site</a>
        </body>
      `);
    }

    // Salva no banco e entra no canal
    await db.upsertStreamer({
      twitch_id:     user.id,
      login:         user.login,
      display_name:  user.display_name,
      access_token:  tokenData.access_token,
      refresh_token: tokenData.refresh_token || null,
    });

    await bot.joinChannel(user.login);

    req.session.streamer = { twitch_id: user.id, login: user.login, display_name: user.display_name };
    res.redirect('/painel');
  } catch (e) {
    console.error('[auth/callback]', e);
    res.redirect('/?erro=interno');
  }
});

// Retorna dados do usuário logado (ou null se não logado) — usado pelo frontend
app.get('/api/me', (req, res) => {
  res.json(req.session?.streamer || null);
});

app.get('/sair', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.get('/desconectar', autenticado, async (req, res) => {
  const { twitch_id, login } = req.session.streamer;
  await db.deactivateStreamer(twitch_id);
  await bot.partChannel(login);
  req.session.destroy();
  res.redirect('/?desconectado=1');
});

// ── Painel admin ──────────────────────────────────────────────────────────────

app.get('/painel', autenticado, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

// ── API (requer autenticação) ─────────────────────────────────────────────────

app.get('/api/me', autenticado, (req, res) => res.json(req.session.streamer));

app.get('/api/settings', autenticado, async (req, res) => {
  const s = await db.getSettings(req.session.streamer.twitch_id);
  res.json(s);
});

app.post('/api/settings', autenticado, async (req, res) => {
  await db.saveSettings(req.session.streamer.twitch_id, req.body);
  bot.invalidateCache(req.session.streamer.twitch_id);
  res.json({ ok: true });
});

app.get('/api/log', autenticado, async (req, res) => {
  const { twitch_id } = req.session.streamer;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const historico = await db.getRecentLog(twitch_id, 100);
  historico.forEach(row => {
    const entry = { ts: new Date(row.created_at).getTime(), tipo: row.tipo, texto: row.msg };
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  });

  bot.addLogListener(twitch_id, res);
  req.on('close', () => bot.removeLogListener(twitch_id, res));
});

app.post('/api/test-cmd', autenticado, (req, res) => {
  const { login } = req.session.streamer;
  const fakeTags = { 'display-name': 'AdminTest', mod: true, badges: { broadcaster: '1' }, subscriber: true };
  // Emite via tmi diretamente
  require('./bot'); // já importado
  res.json({ ok: true, nota: 'Use o chat diretamente para testar comandos' });
});

// ── API Polls ─────────────────────────────────────────────────────────────────

app.post('/api/poll', autenticado, async (req, res) => {
  const { twitch_id, access_token } = await db.getStreamer(req.session.streamer.twitch_id);
  const { titulo, opcoes, duracao, usaPontos, pontos } = req.body;
  const body = {
    broadcaster_id: twitch_id, title: titulo,
    choices: opcoes.map(t => ({ title: t })), duration: duracao,
  };
  if (usaPontos) { body.channel_points_voting_enabled = true; body.channel_points_per_vote = pontos; }
  const data = await cmd.twitchAPI('POST', '/polls', body, access_token, CLIENT_ID);
  data.data?.[0] ? res.json({ ok: true, id: data.data[0].id }) : res.json({ ok: false, erro: JSON.stringify(data) });
});

app.get('/api/poll/:id', autenticado, async (req, res) => {
  const { twitch_id, access_token } = await db.getStreamer(req.session.streamer.twitch_id);
  const data = await cmd.twitchAPI('GET', `/polls?broadcaster_id=${twitch_id}&id=${req.params.id}`, null, access_token, CLIENT_ID);
  res.json(data.data?.[0] || null);
});

app.delete('/api/poll/:id', autenticado, async (req, res) => {
  const { twitch_id, access_token } = await db.getStreamer(req.session.streamer.twitch_id);
  await cmd.twitchAPI('PATCH', '/polls', { broadcaster_id: twitch_id, id: req.params.id, status: 'TERMINATED' }, access_token, CLIENT_ID);
  res.json({ ok: true });
});

// ── API Predições ─────────────────────────────────────────────────────────────

const predicaoOutcomes = new Map();

app.post('/api/prediction', autenticado, async (req, res) => {
  const { twitch_id, access_token } = await db.getStreamer(req.session.streamer.twitch_id);
  const { titulo, azul, rosa, duracao } = req.body;
  const data = await cmd.twitchAPI('POST', '/predictions', {
    broadcaster_id: twitch_id, title: titulo,
    outcomes: [{ title: azul }, { title: rosa }], prediction_window: duracao,
  }, access_token, CLIENT_ID);
  if (data.data?.[0]) {
    predicaoOutcomes.set(twitch_id, data.data[0].outcomes.map(o => o.id));
    res.json({ ok: true, id: data.data[0].id });
  } else res.json({ ok: false, erro: JSON.stringify(data) });
});

app.patch('/api/prediction/:id', autenticado, async (req, res) => {
  const { twitch_id, access_token } = await db.getStreamer(req.session.streamer.twitch_id);
  const { status, winningOutcomeIndex } = req.body;
  const body = { broadcaster_id: twitch_id, id: req.params.id, status };
  if (status === 'RESOLVED') body.winning_outcome_id = predicaoOutcomes.get(twitch_id)?.[winningOutcomeIndex];
  await cmd.twitchAPI('PATCH', '/predictions', body, access_token, CLIENT_ID);
  res.json({ ok: true });
});

// ── Premium — Checkout ────────────────────────────────────────────────────────

app.get('/premium', autenticado, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'premium.html'));
});

app.post('/api/premium/checkout', autenticado, async (req, res) => {
  const { nome, cpf } = req.body;
  const { twitch_id, login, display_name } = req.session.streamer;

  if (!nome || !cpf) return res.json({ ok: false, erro: 'Nome e CPF são obrigatórios.' });

  try {
    // Verifica se já é premium
    if (await db.isPremium(twitch_id)) {
      return res.json({ ok: false, erro: 'Você já possui Premium ativo!' });
    }

    // Recupera ou cria cliente no Asaas
    const streamer   = await db.getStreamer(twitch_id);
    let clienteId    = streamer.asaas_customer_id;

    if (!clienteId) {
      const cliente = await asaas.upsertCliente({ nome, cpf, email: null });
      if (cliente.errors) return res.json({ ok: false, erro: cliente.errors[0]?.description || 'Erro ao criar cliente.' });
      clienteId = cliente.id;
      await db.salvarAsaasCliente(twitch_id, clienteId);
    }

    // Cria cobrança PIX
    const cobranca = await asaas.criarCobrancaPix({
      clienteId,
      twitchId:    twitch_id,
      twitchLogin: login,
      valor:       process.env.PREMIUM_PRECO || '9.00',
    });

    if (cobranca.errors || !cobranca.id) {
      return res.json({ ok: false, erro: cobranca.errors?.[0]?.description || 'Erro ao criar cobrança.' });
    }

    // Busca QR code
    const pix = await asaas.getPixQrCode(cobranca.id);

    res.json({
      ok: true,
      paymentId:   cobranca.id,
      qrCode:      pix.encodedImage,   // base64 da imagem
      copyCola:    pix.payload,         // texto para copiar
      valor:       cobranca.value,
      vencimento:  cobranca.dueDate,
    });
  } catch (e) {
    console.error('[premium/checkout]', e);
    res.json({ ok: false, erro: 'Erro interno. Tente novamente.' });
  }
});

// Verifica status do pagamento (polling do frontend)
app.get('/api/premium/status/:paymentId', autenticado, async (req, res) => {
  const payment = await asaas.getPayment(req.params.paymentId);
  const pago    = ['CONFIRMED', 'RECEIVED'].includes(payment.status);
  res.json({ pago, status: payment.status });
});

// ── Webhook Asaas ─────────────────────────────────────────────────────────────

app.post('/webhooks/asaas', express.json(), async (req, res) => {
  const token = req.headers['asaas-access-token'];
  if (!asaas.verificarWebhook(token)) {
    return res.status(401).json({ erro: 'Token inválido' });
  }

  const { event, payment } = req.body;

  if (['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'].includes(event) && payment?.externalReference) {
    const twitchId = payment.externalReference;
    await db.ativarPremium(twitchId, 1);
    console.log(`[Premium] Ativado para twitch_id: ${twitchId} via webhook Asaas`);
  }

  res.json({ ok: true });
});

// ── API — status premium do usuário logado ────────────────────────────────────

app.get('/api/me/premium', autenticado, async (req, res) => {
  const streamer = await db.getStreamer(req.session.streamer.twitch_id);
  const ativo    = await db.isPremium(streamer.twitch_id);
  res.json({
    premium: ativo,
    expires: streamer.premium_expires_at,
  });
});

// ── Health check + self-ping ──────────────────────────────────────────────────

app.get('/ping', async (req, res) => {
  await db.ping();
  res.json({ ok: true, ts: Date.now(), canais: (await db.getActiveStreamers()).length });
});

// Self-ping a cada 9 minutos (mantém Railway e Supabase ativos)
function iniciarSelfPing() {
  setInterval(async () => {
    try {
      await fetch(`${BASE_URL}/ping`);
      console.log('[ping] OK');
    } catch (e) {
      console.warn('[ping] falhou:', e.message);
    }
  }, 9 * 60 * 1000);
}

// ── Inicialização ─────────────────────────────────────────────────────────────

module.exports = { app, PORT, iniciarSelfPing };
