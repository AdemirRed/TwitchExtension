require('dotenv').config();

// Força resolução DNS priorizando IPv4 (Railway não tem rede IPv6 e o
// Supabase resolve o host direto só em IPv6 → ENETUNREACH). Precisa vir
// antes de qualquer require que abra conexão de rede.
require('dns').setDefaultResultOrder('ipv4first');

const http = require('http');

// ── Diagnóstico de variáveis obrigatórias ─────────────────────────────────────
const REQUIRED = ['DATABASE_URL','TWITCH_CLIENT_ID','TWITCH_CLIENT_SECRET','BOT_OAUTH_TOKEN','SESSION_SECRET'];
let temErro = false;

console.log('\n=== Variáveis de ambiente ===');
REQUIRED.forEach(key => {
  const val = process.env[key];
  if (!val) { console.error(`❌ FALTANDO: ${key}`); temErro = true; }
  else       { console.log(`✅ ${key} = ${val.substring(0,14)}...`); }
});
if (temErro) { console.error('\n❌ Configure as variáveis no Railway → Variables.\n'); process.exit(1); }
console.log('============================\n');

const db  = require('./db');
const bot = require('./bot');
const { app, PORT, iniciarSelfPing, iniciarJobCobranca } = require('./server');

async function main() {
  await db.init();

  // Servidor web sobe SEMPRE — independente do bot do Twitch.
  http.createServer(app).listen(PORT, () => {
    console.log(`\n🚀 Servidor rodando na porta ${PORT}`);
    console.log(`🌐 ${process.env.BASE_URL || 'http://localhost:' + PORT}\n`);
  });

  iniciarSelfPing();
  iniciarJobCobranca();

  // Bot do Twitch sobe separado — se o token estiver expirado/inválido,
  // o app continua de pé e os streamers ainda conseguem logar e configurar.
  bot.start().catch(err => {
    console.error('⚠️  Bot do Twitch não conectou:', err?.message || err);
    console.error('   Verifique/regenere o BOT_OAUTH_TOKEN. O painel continua funcionando.');
  });
}

main().catch(err => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});
