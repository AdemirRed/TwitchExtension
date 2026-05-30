# Guia de Deploy — Passo a Passo

## 1. Criar o banco de dados no Supabase (grátis)

1. Acesse https://supabase.com e crie uma conta
2. Clique em **New Project**
   - Nome: `twitch-bot`
   - Senha do banco: crie uma senha forte e guarde
   - Região: **South America (São Paulo)**
3. Aguarde o projeto criar (~2 min)
4. Vá em **Settings → Database → Connection string → URI**
5. Copie a URI (parece com `postgresql://postgres:[senha]@...supabase.co:5432/postgres`)
6. Guarde — vai no `DATABASE_URL` do Railway

---

## 2. Subir o código no GitHub

1. Crie uma conta em https://github.com se não tiver
2. Crie um novo repositório (pode ser privado)
3. Na pasta `TwitchExtension`, abra o terminal e rode:

```bash
git init
git add .
git commit -m "primeiro deploy"
git remote add origin https://github.com/SEU_USUARIO/SEU_REPO.git
git push -u origin main
```

> **Importante:** Confirme que o `.env` está no `.gitignore` (nunca suba credenciais)

---

## 3. Deploy no Railway

1. Acesse https://railway.app e faça login com o GitHub
2. Clique em **New Project → Deploy from GitHub repo**
3. Selecione o repositório criado
4. Railway detecta o `package.json` e faz deploy automático

### Configurar variáveis de ambiente no Railway:

Vá em **Variables** e adicione:

| Chave | Valor |
|---|---|
| `BOT_USERNAME` | Nome do usuário do bot |
| `BOT_OAUTH_TOKEN` | `oauth:...` (gerado pelo auth.js) |
| `TWITCH_CLIENT_ID` | `c5yhiby5xsxplfuuj1xuszg0j168m7` |
| `TWITCH_CLIENT_SECRET` | `assd8f7a57ogk2f7dl2q2t1xue3r20` |
| `DATABASE_URL` | URI do Supabase |
| `SESSION_SECRET` | String aleatória longa (ex: rode `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `BASE_URL` | URL gerada pelo Railway (ex: `https://twitch-bot-production.up.railway.app`) |
| `PORT` | `8080` |

### Pegar a URL do Railway:
- Vá em **Settings → Networking → Generate Domain**
- Copie a URL e coloque em `BASE_URL`

---

## 4. Atualizar o redirect URI na Twitch

1. Acesse https://dev.twitch.tv/console/apps
2. **ExplorarLocais BOT → Gerenciar**
3. Em **URLs de redirecionamento OAuth**, adicione:
   ```
   https://SEU-APP.up.railway.app/auth/callback
   ```
4. Salve

---

## 5. Configurar UptimeRobot (mantém o Railway vivo)

1. Acesse https://uptimerobot.com e crie conta grátis
2. Clique em **Add New Monitor**
   - Tipo: **HTTP(s)**
   - URL: `https://SEU-APP.up.railway.app/ping`
   - Intervalo: **5 minutos**
3. Salve

Isso garante que Railway recebe uma requisição a cada 5 min e o banco é tocado automaticamente (o `/ping` faz `SELECT 1` no Supabase).

---

## 6. Testar tudo

1. Acesse `https://SEU-APP.up.railway.app`
2. Clique em **Conectar com Twitch**
3. Autorize com sua conta
4. Deve ir para o painel em `/painel`
5. Abra o chat do seu canal na Twitch e teste `!comandos`

---

## 7. Divulgar para outros streamers

Compartilhe o link:
```
https://SEU-APP.up.railway.app
```

Eles clicam em **Conectar com Twitch**, autorizam, e o bot entra no canal automaticamente. Cada um tem seu próprio painel com configurações independentes.

---

## Atualizar o bot depois

Toda vez que fizer mudanças no código:

```bash
git add .
git commit -m "descrição da mudança"
git push
```

O Railway faz deploy automático em ~1 minuto.

---

## Custos estimados

| Serviço | Plano | Custo |
|---|---|---|
| Railway | Starter ($5/mês em créditos) | Grátis para começar |
| Supabase | Free tier (500MB) | Grátis |
| UptimeRobot | Free (50 monitores) | Grátis |
| **Total** | | **R$ 0/mês** |

> Se crescer muito (100+ streamers ativos), Railway pode cobrar ~R$15-30/mês.
