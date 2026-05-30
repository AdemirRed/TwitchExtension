require('dotenv').config();
const http = require('http');

// ── Diagnóstico de variáveis obrigatórias ─────────────────────────────────────
const REQUIRED = ['DATABASE_URL', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'BOT_OAUTH_TOKEN', 'SESSION_SECRET'];
let temErro = false;

console.log('\n=== Variáveis de ambiente ===');
REQUIRED.forEach(key => {
  const val = process.env[key];
  if (!val) {
    console.error(`❌ FALTANDO: ${key}`);
    temErro = true;
  } else {
    console.log(`✅ ${key} = ${val.substring(0, 12)}...`);
  }
});

if (temErro) {
  console.error('\n❌ Variáveis obrigatórias ausentes. Configure-as no Railway → Variables.\n');
  process.exit(1);
}

console.log('============================\n');

const db  = require('./db');
const bot = require('./bot');
const { app, PORT, iniciarSelfPing } = require('./server');

async function main() {
  await db.init();
  await bot.start();

  http.createServer(app).listen(PORT, () => {
    console.log(`\n🚀 ${process.env.BASE_URL || 'http://localhost:' + PORT}`);
  });

  iniciarSelfPing();
}

main().catch(err => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});
