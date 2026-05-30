/**
 * Autenticação Twitch — gera todos os tokens e salva no .env automaticamente.
 * Execute: node auth.js
 *
 * O que este script faz:
 *  1. Sobe um servidor local temporário na porta 3333
 *  2. Abre o navegador com a página de login da Twitch
 *  3. Você faz login e autoriza o bot
 *  4. A Twitch redireciona para localhost:3333 com o código
 *  5. O script troca o código pelo OAuth token do bot (chat)
 *  6. Gera também o App Access Token (para a API de chatters)
 *  7. Descobre o BROADCASTER_ID automaticamente pelo CHANNEL_NAME
 *  8. Salva tudo no .env e encerra
 */

require('dotenv').config();
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const { exec } = require('child_process');

const CLIENT_ID     = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const CHANNEL_NAME  = process.env.CHANNEL_NAME;
const PORT          = 7777;
const REDIRECT_URI  = `http://localhost:${PORT}/callback`;

// Permissões necessárias para o bot de chat
const SCOPES = [
  'chat:read',
  'chat:edit',
  'moderator:manage:banned_users',
  'moderator:read:chatters',
  'channel:manage:broadcast',
  'clips:edit',
  'user:read:broadcast',
  'channel:read:stream_key',
  'moderator:manage:shoutouts',
  'channel:manage:polls',
  'channel:read:polls',
  'channel:manage:predictions',
  'channel:read:predictions',
].join('+');

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\n[ERRO] Configure TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET no .env primeiro!\n');
  process.exit(1);
}
if (!CHANNEL_NAME || CHANNEL_NAME === 'nome_do_seu_canal') {
  console.error('\n[ERRO] Configure CHANNEL_NAME no .env com o nome do seu canal!\n');
  process.exit(1);
}

// ── Helpers HTTP ─────────────────────────────────────────────────────────────

function postJSON(url, params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const opts = new URL(url);
    const req  = https.request(
      { hostname: opts.hostname, path: opts.pathname + opts.search, method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } },
      res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(JSON.parse(data)));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function getJSON(url, headers) {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    https.get(
      { hostname: opts.hostname, path: opts.pathname + opts.search, headers },
      res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(JSON.parse(data)));
      }
    ).on('error', reject);
  });
}

// ── Atualiza uma linha no .env ────────────────────────────────────────────────

function atualizarEnv(chave, valor) {
  let conteudo = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
  const regex  = new RegExp(`^${chave}=.*$`, 'm');
  if (regex.test(conteudo)) {
    conteudo = conteudo.replace(regex, `${chave}=${valor}`);
  } else {
    conteudo += `\n${chave}=${valor}`;
  }
  fs.writeFileSync('.env', conteudo);
}

// ── Abre o browser no Windows ────────────────────────────────────────────────

function abrirBrowser(url) {
  exec(`start "" "${url}"`);
}

// ── Fluxo principal ──────────────────────────────────────────────────────────

async function trocarCodigoPorToken(code) {
  console.log('\n[2/4] Trocando código pelo token do bot...');
  const data = await postJSON('https://id.twitch.tv/oauth2/token', {
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
    grant_type:    'authorization_code',
    redirect_uri:  REDIRECT_URI,
  });

  if (!data.access_token) {
    throw new Error('Token não retornado: ' + JSON.stringify(data));
  }

  const botToken = `oauth:${data.access_token}`;
  atualizarEnv('BOT_OAUTH_TOKEN', botToken);
  console.log('[2/4] BOT_OAUTH_TOKEN salvo no .env');

  // Descobre o BOT_USERNAME automaticamente
  const me = await getJSON('https://api.twitch.tv/helix/users', {
    'Client-Id': CLIENT_ID,
    'Authorization': `Bearer ${data.access_token}`,
  });
  if (me.data && me.data[0]) {
    atualizarEnv('BOT_USERNAME', me.data[0].login);
    console.log(`[2/4] BOT_USERNAME detectado: ${me.data[0].login}`);
  }
}

async function gerarAppToken() {
  console.log('\n[3/4] Gerando App Access Token...');
  const data = await postJSON('https://id.twitch.tv/oauth2/token', {
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type:    'client_credentials',
  });

  if (!data.access_token) {
    throw new Error('App token não retornado: ' + JSON.stringify(data));
  }

  atualizarEnv('TWITCH_APP_ACCESS_TOKEN', data.access_token);
  console.log('[3/4] TWITCH_APP_ACCESS_TOKEN salvo no .env');
  return data.access_token;
}

async function descobrirBroadcasterId(appToken) {
  console.log(`\n[4/4] Buscando ID do canal "${CHANNEL_NAME}"...`);
  const data = await getJSON(
    `https://api.twitch.tv/helix/users?login=${CHANNEL_NAME}`,
    { 'Client-Id': CLIENT_ID, 'Authorization': `Bearer ${appToken}` }
  );

  if (!data.data || !data.data[0]) {
    console.warn(`[4/4] Canal "${CHANNEL_NAME}" não encontrado. Verifique CHANNEL_NAME no .env`);
    return;
  }

  atualizarEnv('BROADCASTER_ID', data.data[0].id);
  console.log(`[4/4] BROADCASTER_ID: ${data.data[0].id} salvo no .env`);
}

// ── Servidor local para receber o callback OAuth ─────────────────────────────

const server = http.createServer(async (req, res) => {
  const params = new URL(req.url, `http://localhost:${PORT}`).searchParams;
  const code   = params.get('code');
  const erro   = params.get('error');

  // Ignora requisições sem code nem error (ex: favicon.ico, prefetch)
  if (!code && !erro) {
    res.writeHead(204); res.end(); return;
  }

  if (erro) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h2>Erro: ${erro}. Feche esta aba e tente novamente.</h2>`);
    server.close();
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#18181b;color:#efeff1">
      <h2 style="color:#9147ff">✅ Autorizado!</h2>
      <p>Pode fechar esta aba. Os tokens foram salvos no .env automaticamente.</p>
    </body></html>
  `);

  server.close();

  try {
    await trocarCodigoPorToken(code);
    const appToken = await gerarAppToken();
    await descobrirBroadcasterId(appToken);
    console.log('\n✅ Tudo configurado! Agora rode: npm run bot\n');
  } catch (err) {
    console.error('\n[ERRO]', err.message);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  const authUrl = [
    'https://id.twitch.tv/oauth2/authorize',
    `?client_id=${CLIENT_ID}`,
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
    `&response_type=code`,
    `&scope=${SCOPES}`,
    `&force_verify=true`,
  ].join('');

  console.log('\n[1/4] Abrindo o navegador para você autorizar o bot na Twitch...');
  console.log('      (Se não abrir automaticamente, acesse a URL abaixo)');
  console.log('\n' + authUrl + '\n');
  abrirBrowser(authUrl);
});
