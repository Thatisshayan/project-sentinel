# Quickstart — Local Development

## Prerequisites

- Docker Desktop (or Docker Engine + Compose)
- Node.js 20+ (for UI dev server)
- A GitHub account with at least one repo to watch

## 1. Clone and configure

```bash
git clone https://github.com/<your-org>/project-sentinel.git
cd project-sentinel
cp backend/.env.example backend/.env
```

Edit `backend/.env` — fill in every required variable:

| Variable | Where to get it |
|----------|----------------|
| `GITHUB_WEBHOOK_SECRET` | Any random string — use `openssl rand -hex 20` |
| `GITHUB_ORG` | Your GitHub username or org name |
| `NOTION_API_KEY` | Notion → Settings → Integrations → New |
| `NOTION_DATABASE_ID` | From the URL of your Notion project database |
| `TELEGRAM_BOT_TOKEN` | @BotFather on Telegram → `/newbot` |
| `TELEGRAM_CHAT_ID` | Your group chat ID (negative number) |
| `DEBUGGER_SHARED_SECRET` | Any random string — use `openssl rand -hex 20` |
| `WATCHED_REPOS` | Comma-separated short repo names, e.g. `myapp,api` |

## 2. Start the stack

```bash
docker compose up -d
```

This starts PostgreSQL, Redis, and the Sentinel backend. Schema is initialised automatically on first run.

Check logs:
```bash
docker compose logs -f backend
```

You should see `Sentinel backend started` within a few seconds.

## 3. Start the UI

```bash
cd ui
cp .env.example .env.local    # set SENTINEL_API_URL=http://localhost:3000
npm install
npm run dev
```

Open [http://localhost:3001](http://localhost:3001).

## 4. Register GitHub webhooks

For each repo you want to monitor, go to:

**GitHub → repo → Settings → Webhooks → Add webhook**

- **Payload URL**: `http://<your-public-url>/webhook/github`  
  (use [ngrok](https://ngrok.com) for local: `ngrok http 3000`)
- **Content type**: `application/json`
- **Secret**: value of `GITHUB_WEBHOOK_SECRET`
- **Events**: Push, Pull request

## 5. Connect Telegram

Register the webhook so Sentinel receives `/sentinel` commands:

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<your-host>/webhook/telegram",
    "secret_token": "<DEBUGGER_SHARED_SECRET>"
  }'
```

## 6. Verify the closed loop

```bash
# Push any commit to a watched repo, then:
TARGET_REPO=<org>/<repo> DATABASE_URL=<your-db-url> node backend/scripts/check-loop.js
```

Exit 0 = closed loop confirmed.

## Stopping

```bash
docker compose down          # stop containers, keep data
docker compose down -v       # stop and delete all data
```
