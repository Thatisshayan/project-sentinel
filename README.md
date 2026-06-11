# Project Sentinel

**Phase 1 — GitHub Push → Notion + Telegram Automation**

A backend service that watches GitHub push events, updates a Notion "Projects Command Center" database, and sends Telegram notifications.

---

## Architecture

```
GitHub push → Railway webhook → HMAC verification → Notion update → Telegram notification
```

### Stack
- **Runtime**: Node.js 20 (Alpine Docker)
- **Framework**: Express 4
- **Database**: Notion API (Projects Command Center)
- **Notifications**: Telegram Bot API
- **Deployment**: Railway
- **Logging**: Pino (structured JSON, secrets redacted)

---

## What It Does

On every `push` event to any tracked repo:

1. **Verifies** the webhook signature (HMAC-SHA256)
2. **Extracts** commit data (message, hash, author, files, branch)
3. **Deduplicates** (same repo+commit within 10 min is skipped)
4. **Finds** the matching project in Notion by `Repo Name`
5. **Updates** the Notion row with commit info + risk level
6. **Appends** a changelog entry to the project page
7. **Sends** a Telegram notification to the group
8. **Handles errors** without crashing (Notion/Telegram failures are logged, not fatal)

---

## File Structure

```
backend/
├── src/
│   ├── index.js            # Express server, env validation, error guards
│   ├── webhook.js          # /webhook/github route, HMAC verification, core loop
│   ├── extractPayload.js   # Parse GitHub push payload
│   ├── notionClient.js     # Find/update/changelog (with bulk + fallback)
│   ├── telegramClient.js   # HTTPS-based Telegram sendMessage
│   ├── deduplication.js    # In-memory dedup with 10-min TTL
│   ├── riskAssessor.js     # Low/Medium/High risk from changed files
│   ├── health.js           # /health endpoint (Notion + Telegram status)
│   └── logger.js           # Pino with secret redaction
── test/
│   ├── extractPayload.test.js
│   ├── notionClient.test.js
│   ├── riskAssessor.test.js
│   └── webhook.test.js
├── .env.example
├── Dockerfile
├── railway.toml
── package.json
```

---

## Environment Variables

All set in Railway Variables dashboard:

| Variable | Description |
|---|---|
| `GITHUB_WEBHOOK_SECRET` | HMAC secret (shared with GitHub webhook config) |
| `NOTION_API_KEY` | Notion integration token |
| `NOTION_DATABASE_ID` | "Projects Command Center" database ID |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `TELEGRAM_CHAT_ID` | Group chat ID (negative number) |
| `PORT` | 3000 (Railway auto-sets) |
| `NODE_ENV` | production |
| `LOG_LEVEL` | info |

---

## Notion Database Fields

The "Projects Command Center" database must have these fields:

| Field | Type |
|---|---|
| Name | Title |
| Repo Name | Text (matching key) |
| Last Commit Message | Text |
| Last Commit Hash | Text |
| Last Commit URL | URL |
| Last Branch | Text |
| Last Commit Author | Text |
| Last Commit Date | Date |
| Changed Files | Text |
| Files Changed Count | Number |
| Last Updated | Date |
| Risk Level | Select (Low / Medium / High) |

---

## Risk Assessment

| Level | Trigger |
|---|---|
| **Low** | Only marketing/image files (`.png`, `.svg`, `/public`, `/assets`, etc.) |
| **High** | Files matching `.env`, `secret`, `auth`, `payment`, `stripe`, `migration`, `dockerfile`, `.github/workflows`, etc. |
| **Medium** | Everything else |

---

## Development

```bash
cd backend
npm install
cp .env.example .env   # fill in values
npm run dev            # nodemon on port 3000
npm test               # jest, all 34 tests
```

---

## Deployment

Railway auto-deploys from `Thatisshayan/project-sentinel` → root directory `backend/`.

```bash
# Health check
curl https://sentinel-backend-production-d225.up.railway.app/health

# Expected response
{"status":"ok","phase":1,"services":{"notion":"ok","telegram":"configured"}}
```

---

## Webhook Config (per repo)

```
Payload URL:  https://sentinel-backend-production-d225.up.railway.app/webhook/github
Content type: application/json
Secret:       [value of GITHUB_WEBHOOK_SECRET]
Events:       Just the push event
Active:       Yes
```

---

## Phase 2 (Future)

- PostgreSQL persistent deduplication
- Build status checking (GitHub Actions, Vercel, Railway)
- Auto-fix debugger (OpenCode / OpenHands)
- Telegram commands (`/sentinel status`, `/sentinel fix`, etc.)
- AI-generated commit summaries
