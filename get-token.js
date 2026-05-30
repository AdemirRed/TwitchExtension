/**
 * Gera um App Access Token para usar na API da Twitch.
 * Execute: node get-token.js
 * Depois cole o token gerado no .env como TWITCH_APP_ACCESS_TOKEN
 */
require('dotenv').config();
const fetch = require('node-fetch');

const CLIENT_ID     = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Configure TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET no .env');
  process.exit(1);
}

async function main() {
  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials`,
    { method: 'POST' }
  );
  const data = await res.json();
  if (data.access_token) {
    console.log('\nToken gerado com sucesso!');
    console.log('Cole isso no seu .env:\n');
    console.log(`TWITCH_APP_ACCESS_TOKEN=${data.access_token}`);
    console.log(`\nExpira em: ${Math.floor(data.expires_in / 3600)} horas`);
  } else {
    console.error('Erro ao gerar token:', data);
  }
}

main();
