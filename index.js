require('dotenv').config();
const fs   = require('fs');
const http  = require('http');
const https = require('https');
const path  = require('path');

// ── Diagnóstico de variáveis obrigatórias ─────────────────────────────────────
const REQUIRED = ['DATABASE_URL','TWITCH_CLIENT_ID','TWITCH_CLIENT_SECRET','BOT_OAUTH_TOKEN','SESSION_SECRET'];
let temErro = false;

console.log('\n=== Variáveis de ambiente ===');
REQUIRED.forEach(key => {
  const val = process.env[key];
  if (!val) { console.error(`❌ FALTANDO: ${key}`); temErro = true; }
  else       { console.log(`✅ ${key} = ${val.substring(0,14)}...`); }
});
if (temErro) { console.error('\n❌ Configure as variáveis faltantes e reinicie.\n'); process.exit(1); }
console.log('============================\n');

const db  = require('./db');
const bot = require('./bot');
const { app, PORT, iniciarSelfPing } = require('./server');

// ── Detecta modo HTTPS ou HTTP ────────────────────────────────────────────────
const CERT_PATH = path.join(__dirname, 'certs', 'cert.pem');
const KEY_PATH  = path.join(__dirname, 'certs', 'key.pem');
const usaHTTPS  = fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH);

async function main() {
  await db.init();
  await bot.start();

  if (usaHTTPS) {
    const options = {
      cert: fs.readFileSync(CERT_PATH),
      key:  fs.readFileSync(KEY_PATH),
    };
    https.createServer(options, app).listen(PORT, () => {
      console.log(`🔒 HTTPS ativo em ${process.env.BASE_URL} (porta ${PORT})`);
    });
    // Redireciona HTTP 80 → HTTPS
    http.createServer((req, res) => {
      res.writeHead(301, { Location: `https://${req.headers.host}${req.url}` });
      res.end();
    }).listen(80, () => console.log('↪ HTTP :80 redirecionando para HTTPS'));
  } else {
    http.createServer(app).listen(PORT, () => {
      console.log(`🌐 HTTP ativo em ${process.env.BASE_URL} (porta ${PORT})`);
    });
  }

  iniciarSelfPing();
}

main().catch(err => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});
