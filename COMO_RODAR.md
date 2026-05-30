# Twitch Extension - Guia de Setup

## Estrutura dos arquivos

```
TwitchExtension/
├── public/
│   ├── panel.html          → Painel lateral (espectadores)
│   ├── video_overlay.html  → Efeitos sobre o vídeo
│   ├── video_component.html→ Componente no canto do vídeo
│   ├── mobile.html         → Versão mobile
│   ├── config.html         → Configurações do streamer
│   ├── css/style.css
│   └── js/
│       ├── twitch-ext.js   → Wrapper do helper (com fallback dev)
│       ├── panel.js
│       ├── overlay.js
│       └── config.js
├── server.js               → Servidor HTTPS local (porta 8080)
├── gen-cert.js             → Gera certificado SSL autoassinado
└── package.json
```

## 1. Instalar dependências

```bash
cd TwitchExtension
npm install
```

## 2. Gerar certificado SSL (necessário 1x)

```bash
npm run gen-cert
```

Isso cria `certs/cert.pem` e `certs/key.pem`.

## 3. Rodar o servidor local

```bash
npm start
```

O servidor sobe em `https://localhost:8080`.

**Importante:** Acesse `https://localhost:8080/panel.html` no navegador
e aceite o certificado autoassinado (botão "Avançado > Continuar").
Só precisa fazer isso 1x por sessão.

## 4. Testar no Developer Rig da Twitch

- Acesse: https://dev.twitch.tv/console/extensions
- Na sua extensão, vá em **Versões > 0.0.1 > Teste local**
- Clique em **Ver no Rig** (ou use o Developer Rig desktop)
- O `testing_base_uri` já está configurado como `https://localhost:8080/`

## 5. Comandos disponíveis

| Comando    | Efeito                          |
|------------|---------------------------------|
| `!hidrate` | Lembrete de hidratação 💧       |
| `!alongar` | Lembrete de alongamento 🧘      |
| `!skill`   | Culpar a skill 💀               |
| `!lurk`    | Entrar em modo lurk 👻          |
| `!hype`    | Hype com confetti 🔥            |

## 6. Adicionar novos comandos

Edite `public/js/panel.js` e `public/js/overlay.js` — o objeto `COMMANDS`/`EFFECTS` no topo de cada arquivo.

## 7. Integração com o backend (futuro)

Para vincular com o site de Pontos Turísticos:
- O backend deve chamar a API de PubSub da Twitch
- Endpoint: `POST https://api.twitch.tv/helix/extensions/pubsub`
- O frontend já escuta via `TwitchExt.listen('broadcast', ...)`
