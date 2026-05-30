require('dotenv').config();
const http   = require('http');
const db     = require('./db');
const bot    = require('./bot');
const { app, PORT, iniciarSelfPing } = require('./server');

async function main() {
  // 1. Banco de dados
  await db.init();

  // 2. Bot TMI (multi-canal)
  await bot.start();

  // 3. Servidor web
  http.createServer(app).listen(PORT, () => {
    console.log(`\n🚀 Servidor em ${process.env.BASE_URL || 'http://localhost:' + PORT}`);
    console.log(`📺 Landing:  ${process.env.BASE_URL || 'http://localhost:' + PORT}/`);
    console.log(`⚙️  Painel:   ${process.env.BASE_URL || 'http://localhost:' + PORT}/painel\n`);
  });

  // 4. Self-ping (mantém Railway + Supabase ativos)
  iniciarSelfPing();
}

main().catch(err => {
  console.error('Erro fatal na inicialização:', err);
  process.exit(1);
});
