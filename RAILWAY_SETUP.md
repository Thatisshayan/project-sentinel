# Railway Setup Instructions

## Step 1: Add Environment Variables
Go to your Railway dashboard → **project-sentinel** project → **sentinel-backend** service → **Variables** tab.

Add these:

| Variable | Value |
|----------|-------|
| NOTION_API_KEY | From .env.MD |
| NOTION_DATABASE_ID | `<your-notion-database-id>` |
| TELEGRAM_BOT_TOKEN | From .env.MD |
| TELEGRAM_CHAT_ID | `<your-telegram-chat-id>` |
| GITHUB_TOKEN | From .env.MD |
| VERCEL_TOKEN | From .env.MD |
| RAILWAY_TOKEN | From .env.MD |
| RAILWAY_PROJECT_ID | `<your-railway-project-id>` |

## Step 2: Connect GitHub Repo
In the **sentinel-backend** service → **Settings** → **Connect repo**.
Select: `<your-github-username>/project-sentinel`
Root directory: `backend/`

## Step 3: Deploy
Railway will auto-deploy when the repo is connected.
The app starts with: `node dist/index.js`
Health check: `/health`

## Step 4: Get Webhook URL
After deployment, Railway gives you a public URL like: `https://sentinel-backend.up.railway.app`
The webhook endpoint is: `https://sentinel-backend.up.railway.app/webhook/github`

## Step 5: Add GitHub Webhooks
For each repo in Notion, add a webhook:
- Payload URL: `https://sentinel-backend.up.railway.app/webhook/github`
- Content type: `application/json`
- Events: Just the `push` event
- Secret: (optional)
