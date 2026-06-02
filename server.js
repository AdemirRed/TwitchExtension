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
const mailer    = require('./mailer');

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

// Retorna dados do usuário logado (ou null) — nunca redireciona, sempre JSON
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

// Middleware que retorna JSON 401 em vez de redirecionar (para chamadas de API)
function autenticadoAPI(req, res, next) {
  if (req.session?.streamer) return next();
  res.status(401).json({ erro: 'Não autenticado. Faça login novamente.' });
}

// ── API (requer autenticação) ─────────────────────────────────────────────────

app.get('/api/settings', autenticadoAPI, async (req, res) => {
  const s = await db.getSettings(req.session.streamer.twitch_id);
  res.json(s);
});

// Comandos que vêm por padrão (não contam como "customizados")
const CMDS_PADRAO = ['!leitar','!hidrate','!alongar','!skill','!hype','!lurk'];
const LIMITE_CUSTOM_FREE = 5;

app.post('/api/settings', autenticadoAPI, async (req, res) => {
  const twitchId = req.session.streamer.twitch_id;
  const premium  = await db.isPremium(twitchId);
  const novo     = req.body;

  // Gating do plano grátis: máximo de comandos customizados
  if (!premium) {
    const custom = Object.keys(novo.commands || {}).filter(c => !CMDS_PADRAO.includes(c));
    if (custom.length > LIMITE_CUSTOM_FREE) {
      return res.status(403).json({
        ok: false,
        erro: `Plano grátis permite até ${LIMITE_CUSTOM_FREE} comandos customizados. Você tem ${custom.length}. Assine o Premium para ilimitados.`,
        premium_required: true,
      });
    }
  }

  await db.saveSettings(twitchId, novo);
  bot.invalidateCache(twitchId);
  res.json({ ok: true });
});

app.get('/api/log', autenticadoAPI, async (req, res) => {
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

app.post('/api/test-cmd', autenticadoAPI, async (req, res) => {
  const { login } = req.session.streamer;
  const { cmd: cmdMsg } = req.body;
  try {
    await bot.invocarComando(login, cmdMsg);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, erro: e.message });
  }
});

// Middleware: bloqueia recurso premium para plano grátis
async function exigePremium(req, res, next) {
  if (await db.isPremium(req.session.streamer.twitch_id)) return next();
  res.status(403).json({ ok: false, premium_required: true, erro: 'Recurso exclusivo do Premium. Assine para usar enquetes e predições.' });
}

// ── API Polls (Premium) ───────────────────────────────────────────────────────

app.post('/api/poll', autenticadoAPI, exigePremium, async (req, res) => {
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

app.get('/api/poll/:id', autenticadoAPI, async (req, res) => {
  const { twitch_id, access_token } = await db.getStreamer(req.session.streamer.twitch_id);
  const data = await cmd.twitchAPI('GET', `/polls?broadcaster_id=${twitch_id}&id=${req.params.id}`, null, access_token, CLIENT_ID);
  res.json(data.data?.[0] || null);
});

app.delete('/api/poll/:id', autenticadoAPI, async (req, res) => {
  const { twitch_id, access_token } = await db.getStreamer(req.session.streamer.twitch_id);
  await cmd.twitchAPI('PATCH', '/polls', { broadcaster_id: twitch_id, id: req.params.id, status: 'TERMINATED' }, access_token, CLIENT_ID);
  res.json({ ok: true });
});

// ── API Predições ─────────────────────────────────────────────────────────────

const predicaoOutcomes = new Map();

app.post('/api/prediction', autenticadoAPI, exigePremium, async (req, res) => {
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

app.patch('/api/prediction/:id', autenticadoAPI, async (req, res) => {
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

// Retorna os preços (para o frontend exibir)
app.get('/api/premium/precos', (req, res) => {
  res.json({ mensal: asaas.PRECO_MENSAL, vitalicio: asaas.PRECO_VITALICIO });
});

app.post('/api/premium/checkout', autenticadoAPI, async (req, res) => {
  const { nome, cpf, email, plano } = req.body;
  const { twitch_id } = req.session.streamer;

  if (!nome || !cpf || !email) return res.json({ ok: false, erro: 'Nome, CPF e e-mail são obrigatórios.' });
  if (!['mensal', 'vitalicio'].includes(plano)) return res.json({ ok: false, erro: 'Plano inválido.' });

  try {
    if (await db.isPremium(twitch_id)) {
      return res.json({ ok: false, erro: 'Você já possui Premium ativo!' });
    }

    // Salva e-mail do streamer para lembretes
    await db.salvarEmailStreamer(twitch_id, email);

    // Cria/recupera cliente no Asaas
    const streamer = await db.getStreamer(twitch_id);
    let clienteId  = streamer.asaas_customer_id;
    if (!clienteId) {
      const cliente = await asaas.upsertCliente({ nome, cpf, email });
      if (cliente.errors) return res.json({ ok: false, erro: cliente.errors[0]?.description || 'Erro ao criar cliente.' });
      clienteId = cliente.id;
      await db.salvarAsaasCliente(twitch_id, clienteId);
    }

    if (plano === 'vitalicio') {
      const cobranca = await asaas.criarCobrancaVitalicio({ clienteId, twitchId: twitch_id });
      if (cobranca.errors || !cobranca.id) {
        return res.json({ ok: false, erro: cobranca.errors?.[0]?.description || 'Erro ao criar cobrança.' });
      }
      // invoiceUrl = página do Asaas onde escolhe pix/cartão/boleto
      return res.json({ ok: true, redirect: cobranca.invoiceUrl });
    }

    // mensal — assinatura recorrente
    const assinatura = await asaas.criarAssinaturaMensal({ clienteId, twitchId: twitch_id });
    if (assinatura.errors || !assinatura.id) {
      return res.json({ ok: false, erro: assinatura.errors?.[0]?.description || 'Erro ao criar assinatura.' });
    }
    await db.salvarAssinatura(twitch_id, assinatura.id);

    // Pega a 1ª cobrança para mandar o cliente pagar
    const primeira = await asaas.getPrimeiraCobrancaAssinatura(assinatura.id);
    return res.json({ ok: true, redirect: primeira?.invoiceUrl || `https://www.asaas.com` });

  } catch (e) {
    console.error('[premium/checkout]', e);
    res.json({ ok: false, erro: 'Erro interno. Tente novamente.' });
  }
});

// Cancelar assinatura mensal
app.post('/api/premium/cancelar', autenticadoAPI, async (req, res) => {
  const streamer = await db.getStreamer(req.session.streamer.twitch_id);
  if (streamer.asaas_subscription_id) {
    await asaas.cancelarAssinatura(streamer.asaas_subscription_id);
  }
  res.json({ ok: true, nota: 'Assinatura cancelada. O Premium continua até o fim do período pago.' });
});

// ── Webhook Asaas ─────────────────────────────────────────────────────────────

app.post('/webhooks/asaas', express.json(), async (req, res) => {
  const token = req.headers['asaas-access-token'];
  if (!asaas.verificarWebhook(token)) {
    return res.status(401).json({ erro: 'Token inválido' });
  }

  const { event, payment } = req.body;

  if (['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'].includes(event) && payment) {
    let twitchId = null;
    let plano    = null;

    // 1) Tenta pelo externalReference ("twitchId:plano")
    if (payment.externalReference) {
      const partes = payment.externalReference.split(':');
      twitchId = partes[0];
      plano    = partes[1];
    }

    // 2) Fallback: busca pelo subscription/customer (cobranças de assinatura
    //    nem sempre repassam o externalReference)
    if (!twitchId) {
      const s = await db.getStreamerPorAsaas({
        subscriptionId: payment.subscription,
        customerId:     payment.customer,
      });
      if (s) {
        twitchId = s.twitch_id;
        // Se veio de assinatura → mensal; senão usa o plano salvo
        plano = payment.subscription ? 'mensal' : (s.plano || 'mensal');
      }
    }

    // 3) Se ainda assim achou plano nulo, deduz pelo valor
    if (twitchId && !plano) {
      plano = Number(payment.value) >= (asaas.PRECO_VITALICIO - 1) ? 'vitalicio' : 'mensal';
    }

    if (twitchId) {
      await db.ativarPremium(twitchId, plano || 'mensal');
      console.log(`[Premium] Ativado (${plano}) para ${twitchId} via Asaas [${event}]`);

      const streamer = await db.getStreamer(twitchId);
      if (streamer?.email) {
        mailer.confirmacaoAssinatura(streamer.email, {
          plano: plano || 'mensal',
          expira: streamer.premium_expires_at,
        });
      }
    } else {
      console.warn('[webhook] Pagamento recebido mas streamer não identificado:', payment.id);
    }
  }

  res.json({ ok: true });
});

// ── API — status premium do usuário logado ────────────────────────────────────

app.get('/api/me/premium', autenticadoAPI, async (req, res) => {
  const streamer = await db.getStreamer(req.session.streamer.twitch_id);
  const ativo    = await db.isPremium(streamer.twitch_id);
  res.json({
    premium: ativo,
    expires: streamer.premium_expires_at,
  });
});

// ── Página pública de comandos (/c/:login) ────────────────────────────────────

app.get('/c/:login', async (req, res) => {
  const login = req.params.login.toLowerCase();
  const streamers = await db.getActiveStreamers();
  const streamer  = streamers.find(s => s.login.toLowerCase() === login);
  if (!streamer) return res.status(404).send('<h2 style="font-family:sans-serif;color:#efeff1;background:#18181b;padding:40px">Canal não encontrado ou bot não ativo.</h2>');

  const settings = await db.getSettings(streamer.twitch_id);
  const cmds = Object.entries(settings.commands || {}).filter(([,c]) => c.enabled);

  const extras = [];
  if (settings.pix?.enabled && settings.pix?.chave) extras.push({ cmd:'!pix', desc:'Chave Pix do streamer', emoji:'💸' });
  if (settings.moderation?.ban_enabled)     extras.push({ cmd:'!ban @usuario [motivo]', desc:'Bane um usuário (mods)', emoji:'🔨' });
  if (settings.moderation?.timeout_enabled) extras.push({ cmd:'!timeout @usuario [seg]', desc:'Timeout temporário (mods)', emoji:'⏱' });
  if (settings.stream?.mude_titulo_enabled) extras.push({ cmd:'!mude Título', desc:'Muda o título da live (mods)', emoji:'✏️' });
  if (settings.stream?.mude_jogo_enabled)   extras.push({ cmd:'!jogo Nome', desc:'Muda o jogo (mods)', emoji:'🎮' });
  if (settings.stream?.clip_enabled)        extras.push({ cmd:'!clip', desc:'Cria um clip', emoji:'🎬' });
  if (settings.stream?.uptime_enabled)      extras.push({ cmd:'!uptime', desc:'Tempo de live', emoji:'⏰' });
  if (settings.social?.discord)             extras.push({ cmd:'!discord', desc:'Link do Discord', emoji:'💬' });
  if (settings.social?.instagram)           extras.push({ cmd:'!instagram', desc:'Instagram', emoji:'📸' });
  if (settings.social?.youtube)             extras.push({ cmd:'!youtube', desc:'YouTube', emoji:'▶️' });
  if (settings.social?.twitter)             extras.push({ cmd:'!twitter', desc:'Twitter/X', emoji:'🐦' });

  const permLabel = p => ({todos:'Todos',subs:'Subs+',vip:'VIP+',mods:'Mods',broadcaster:'Streamer'})[p]||p;

  const rows = cmds.map(([c,cfg]) => `
    <tr>
      <td><code>${c}</code></td>
      <td>${cfg.emoji||'❓'} ${(cfg.mensagens||[''])[0].replace(/\{usuario\}/g,'@você').substring(0,60)}...</td>
      <td>${permLabel(cfg.permissao||'todos')}</td>
      <td>${(cfg.cooldown_ms||0)/1000}s</td>
    </tr>`).join('');

  const rowsExtra = extras.map(e => `
    <tr>
      <td><code>${e.cmd}</code></td>
      <td>${e.emoji} ${e.desc}</td>
      <td>—</td><td>—</td>
    </tr>`).join('');

  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Comandos de ${streamer.display_name || login}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',sans-serif;background:#0e0e10;color:#efeff1;min-height:100vh;padding:32px 16px}
.container{max-width:800px;margin:0 auto}
h1{font-size:22px;font-weight:800;margin-bottom:4px}
h1 span{color:#9147ff}
.sub{color:#adadb8;font-size:13px;margin-bottom:24px}
table{width:100%;border-collapse:collapse;background:#18181b;border-radius:10px;overflow:hidden}
th{background:#1f1f23;color:#9147ff;font-size:12px;text-transform:uppercase;letter-spacing:.5px;padding:12px 16px;text-align:left}
td{padding:12px 16px;font-size:13px;border-bottom:1px solid #2a2a2d;color:#adadb8}
td:first-child{color:#efeff1}
code{background:#2a2a2d;padding:2px 8px;border-radius:4px;color:#9147ff;font-size:12px}
tr:last-child td{border-bottom:none}
.section-title{font-size:12px;color:#5a5a64;text-transform:uppercase;letter-spacing:.5px;margin:24px 0 10px}
.badge{background:#9147ff22;border:1px solid #9147ff55;color:#9147ff;border-radius:12px;padding:2px 10px;font-size:11px}
</style>
</head>
<body>
<div class="container">
  <h1>Comandos de <span>@${streamer.display_name || login}</span></h1>
  <p class="sub">Lista de comandos disponíveis no chat · <a href="https://explorarbot.up.railway.app" style="color:#9147ff">ExplorarBot</a></p>

  <div class="section-title">Comandos de zoeira</div>
  <table>
    <tr><th>Comando</th><th>Descrição</th><th>Quem pode usar</th><th>Cooldown</th></tr>
    ${rows || '<tr><td colspan="4" style="color:#5a5a64;text-align:center">Nenhum comando customizado ativo</td></tr>'}
  </table>

  ${rowsExtra ? `<div class="section-title">Outros comandos</div>
  <table>
    <tr><th>Comando</th><th>Descrição</th><th></th><th></th></tr>
    ${rowsExtra}
  </table>` : ''}
</div>

<!-- Banner ExplorarLocais -->
<div style="background:linear-gradient(135deg,#1a0a2e,#0a1a2e);border-top:1px solid #2a2a2d;padding:28px 16px;margin-top:32px">
  <div style="max-width:800px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap">
    <div style="display:flex;align-items:center;gap:14px">
      <div style="width:42px;height:42px;background:#9147ff;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">🗺️</div>
      <div>
        <div style="font-size:15px;font-weight:800;color:#efeff1">ExplorarLocais</div>
        <div style="font-size:12px;color:#adadb8">Descubra os melhores pontos turísticos do Brasil</div>
      </div>
    </div>
    <a href="https://explorarlocais.com.br/" target="_blank" rel="noopener"
       style="background:#9147ff;color:#fff;border-radius:8px;padding:10px 24px;font-size:13px;font-weight:700;text-decoration:none;white-space:nowrap;flex-shrink:0">
      Explorar agora →
    </a>
  </div>
</div>
<div style="text-align:center;padding:16px;font-size:11px;color:#3a3a3d">
  Powered by <a href="${BASE_URL}" style="color:#9147ff;text-decoration:none">ExplorarBot</a>
</div>
</body></html>`);
});

// API pública de comandos (para o bot enviar no chat)
app.get('/api/c/:login', async (req, res) => {
  const login = req.params.login.toLowerCase();
  const streamers = await db.getActiveStreamers();
  const streamer  = streamers.find(s => s.login.toLowerCase() === login);
  if (!streamer) return res.json(null);
  const settings = await db.getSettings(streamer.twitch_id);
  res.json({ ok: true, url: `${BASE_URL}/c/${login}` });
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

// ── Job diário: lembretes de cobrança + expiração ─────────────────────────────
function iniciarJobCobranca() {
  const rodar = async () => {
    try {
      // Lembretes: mensais vencendo em 3 dias
      const vencendo = await db.premiumVencendo(3);
      for (const s of vencendo) {
        if (s.email) {
          await mailer.lembreteCobranca(s.email, {
            valor: asaas.PRECO_MENSAL,
            vencimento: s.premium_expires_at,
            invoiceUrl: `${BASE_URL}/premium`,
          });
          await db.marcarLembreteEnviado(s.twitch_id);
        }
      }
      // Expirados: desativa premium e avisa
      const expirados = await db.premiumExpirados();
      for (const s of expirados) {
        await db.desativarPremium(s.twitch_id);
        if (s.email) await mailer.premiumExpirado(s.email);
        console.log(`[Premium] Expirou para ${s.login}`);
      }
    } catch (e) {
      console.error('[job cobranca] erro:', e.message);
    }
  };
  rodar(); // roda uma vez no boot
  setInterval(rodar, 12 * 60 * 60 * 1000); // a cada 12h
}

// ── Inicialização ─────────────────────────────────────────────────────────────

module.exports = { app, PORT, iniciarSelfPing, iniciarJobCobranca };
