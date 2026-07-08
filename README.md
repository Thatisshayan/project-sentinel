# Project Sentinel

An autonomous DevOps AI that manages a portfolio of GitHub repositories for a solo founder. Sentinel monitors commits, audits code, generates improvement tasks, executes them via AI agents, opens PRs, and reports business intelligence — all through Telegram.

---

## What it does

1. **Watches** every push across 12+ GitHub repos via webhooks
2. **Audits** code using NVIDIA NIM (free) — generates 10 prioritised improvement tasks per repo
3. **Executes** safe tasks automatically using [aider](https://aider.chat) with your chosen AI provider
4. **Opens PRs** for completed tasks; tracks merge/reject status
5. **Reports** daily portfolio health, CEO-level summaries, security posture, sprint velocity
6. **Coordinates** agents in a Telegram group with individual bot identities per AI provider

No Anthropic API required. Everything runs on free/cheap AI providers: NVIDIA NIM, Gemini, DashScope Qwen, DeepSeek.

---

## Architecture

```
GitHub webhooks
      │
      ▼
Railway (Node.js + Express)
      │
      ├── Webhook handler    → extracts commit, finds Notion project, updates dashboard
      ├── Audit engine       → NVIDIA NIM generates 10 tasks as JSON
      ├── Task queue         → PostgreSQL (audit_tasks) + Redis/BullMQ
      ├── Builder agents     → aider CLI with pluggable AI providers
      ├── PR creator         → GitHub API opens PRs, tracks outcomes
      ├── Sprint planner     → weekly AI-generated sprint proposals via Telegram
      ├── Security scanner   → dependency + secret + OWASP scanning on every push
      ├── Self-scaler        → auto-adjusts batch size based on budget burn rate
      ├── Cross-repo coord   → triggers dependent repo audits (e.g. session-guard → tapcash)
      └── Telegram bot       → commands, inline menus, multi-agent room, conversation memory
            │
            └── Per-agent bots (Nemotron, Qwen, Gemini, DeepSeek, Qwen Dash)
```

**Stack:** Node.js 20 · Express · PostgreSQL · Redis · BullMQ · aider · simple-git · @notionhq/client

---

## AI Providers (free-first, Anthropic last resort)

| Provider | Env Var | Used for |
|---|---|---|
| NVIDIA NIM | `NVIDIA_API_KEY` | Audits, analysis, primary builder |
| Google Gemini | `GEMINI_API_KEY` | Debugging, creative tasks, fallback builder |
| DashScope (Qwen) | `DASHSCOPE_API_KEY` | Code tasks (Qwen 2.5 Coder), fast batch work |
| DeepSeek | `DEEPSEEK_API_KEY` | Cheap fallback, routine tasks |
| Anthropic | `ANTHROPIC_API_KEY` | Last resort only — never the default |

---

## Environment Variables

### Required
```
GITHUB_WEBHOOK_SECRET     GitHub webhook signature secret
NOTION_API_KEY            Notion integration token
NOTION_DATABASE_ID        ID of your Projects database in Notion
TELEGRAM_BOT_TOKEN        Main Sentinel bot token (from BotFather)
TELEGRAM_CHAT_ID          Your Telegram group chat ID
```

### Phase 2+ (enable full features)
```
GITHUB_TOKEN              Personal access token (repo + webhook scope)
DATABASE_URL              PostgreSQL connection string
REDIS_URL                 Redis connection string
DEBUGGER_SHARED_SECRET    Telegram webhook validation secret
NVIDIA_API_KEY            NVIDIA NIM API key (primary AI provider)
GEMINI_API_KEY            Google Gemini API key
DASHSCOPE_API_KEY         Alibaba DashScope API key (Qwen models)
DEEPSEEK_API_KEY          DeepSeek API key
```

### Optional
```
TELEGRAM_CHAT_ID          Group chat ID
AGENT_ROOM_TOPIC_ID       Topic ID for #agent-room thread
WATCHED_REPOS             Comma-separated list of repos to auto-onboard
RAILWAY_PUBLIC_DOMAIN     Auto-set by Railway; used for webhook URLs
AUDIT_AGENT_ENABLED       Set to false to disable automatic audits (default: true)
BUILDER_AGENT_ENABLED     Set to false to disable task execution (default: true)
SPRINT_AUTO_APPROVE       Set to true to auto-approve sprints after 2h (default: false)
TASK_BATCH_SIZE           Tasks per execution batch (default: 5)
MAX_BUILDER_TASKS_PER_DAY Max tasks executed per day per repo (default: 10)
SPRINT_MONTHLY_BUDGET     Monthly AI spend budget in USD (default: 30)
CROSS_REPO_DEPS           JSON dependency map for cross-repo audit triggers
METRICS_SOURCES           JSON array of HTTP metric connectors for business data
AUDIT_COOLDOWN_HOURS      Hours between audits per repo (default: 12)
```

### Per-agent bot tokens
```
BOT_TOKEN_NEMOTRON        @nemotronsintelbot token
BOT_TOKEN_QWEN_CODER      @qwencodersintenelbot token
BOT_TOKEN_QWEN_CODER_DASH @qwendashsentinelbot token
BOT_TOKEN_GEMINI          @geminisentinelbot token
BOT_TOKEN_DEEPSEEK        @deepseeksentinelBot token
```

---

## Deployment (Railway)

1. Fork this repo and connect it to Railway
2. Set environment variables in Railway dashboard
3. Railway auto-deploys on every push to `main`
4. Set up GitHub webhooks for each repo:
   - URL: `https://<your-railway-domain>/webhook/github`
   - Events: **Push**, **Pull request**
   - Secret: same as `GITHUB_WEBHOOK_SECRET`

The Dockerfile installs Node.js 20, Python 3, Git, and aider. The app starts on port 3000.

---

## Dashboard (UI)

`ui/` is a Next.js 14 (App Router) dashboard — portfolio overview, per-repo detail,
agent status, sprint board, security scores, and a live agent-room terminal. It
never talks to the backend directly from the browser; all data flows through
Next.js's own server-side routes, which proxy to the backend's `/api/*` routes.

### Running it locally

```bash
cd ui
cp .env.example .env.local   # fill in SENTINEL_API_URL + SENTINEL_UI_KEY
npm install
npm run dev                  # http://localhost:3000 (backend must be running separately)
```

Or via `docker-compose up` from the repo root, which starts Postgres, Redis, the
backend, and the UI together (UI reachable at `http://localhost:3001`).

### Environment Variables

```
SENTINEL_API_URL   Base URL of the backend, no trailing slash (e.g. http://localhost:3000)
SENTINEL_UI_KEY    Must match the backend's SENTINEL_UI_KEY exactly
```

### Deployment (Railway)

Deploys the same way as the backend — connect `ui/` as a separate Railway service
(root directory `ui/`), set `SENTINEL_API_URL` to the backend service's public URL
and `SENTINEL_UI_KEY` to match the backend's value.

---

## Telegram Commands

### Core
| Command | What it does |
|---|---|
| `/sentinel audit <repo>` | Force a fresh audit — generates 10 tasks |
| `/sentinel execute <repo>` | Start executing queued tasks |
| `/sentinel force-execute <repo>` | Unlock all tasks (including unsafe) and execute |
| `/sentinel stop <repo>` | Stop all activity on a repo |
| `/sentinel tasks <repo>` | List queued tasks |
| `/sentinel status <repo>` | Current build + task status |

### Reports
| Command | What it does |
|---|---|
| `/sentinel report` | Send daily portfolio report |
| `/sentinel dashboard` | Live status card (health, agents, budget) |
| `/sentinel health` | Portfolio health scores for all repos |
| `/sentinel weekly` | Weekly business + tech report |
| `/sentinel ceo` | Generate CEO-level summary |
| `/sentinel velocity` | Sprint velocity trend |
| `/sentinel costs` | API spend breakdown |
| `/sentinel business <repo>` | Business metrics for a repo |
| `/sentinel security <repo>` | Security posture for a repo |
| `/sentinel patterns` | Cross-repo pattern analysis |
| `/sentinel impact <repo>` | PR impact analysis |

### Sprint
| Command | What it does |
|---|---|
| `/sentinel propose-sprint` | Generate weekly sprint proposal |
| `/sentinel approve-sprint` | Approve the pending sprint |
| `/sentinel skip-sprint` | Skip this week's sprint |
| `/sentinel sprint-status` | Current sprint progress |
| `/sentinel run-sprint` | Resume sprint execution |
| `/sentinel pause-sprint` | Pause sprint |

### Agents
| Command | What it does |
|---|---|
| `/sentinel agents` | Show all agents and current status |
| `/sentinel what` | What are agents doing right now? |
| `/sentinel standup` | Run agent standup (shows 7-day real stats) |
| `/sentinel leaderboard` | Post agent performance leaderboard |
| `/sentinel test-bots` | Test all configured agent bots |
| `/sentinel bots` | Show configured vs. missing bot tokens |

### System
| Command | What it does |
|---|---|
| `/sentinel webhook-status` | Which repos are sending webhook events |
| `/sentinel self-audit` | Run Sentinel self-audit |
| `/sentinel self-approve` | Approve Sentinel's own improvement tasks |
| `/sentinel lock <repo>` | Lock a repo (no agents will touch it) |
| `/sentinel unlock <repo>` | Unlock a repo |
| `/sentinel security-scan <repo>` | Run security scan manually |
| `/sentinel memory` | Show last 10 conversation exchanges |
| `/sentinel help` | Interactive command menu |

### Natural language (just type in the group)
```
start working on tapcash
audit AlphonsoEcosystem
add dark mode to tapcash        → creates a task
fix the login bug in session-guard  → creates a task
what is qwen_coder doing?
assign tapcash to gemini
```

---

## How work actually happens

```
Human commits to a repo
        ↓
GitHub webhook → Sentinel backend
        ↓
Risk assessment + deduplication check
        ↓
NVIDIA NIM audits the repo → 10 tasks (JSON)
        ↓
Tasks saved to PostgreSQL + Notion
        ↓
Telegram: "Audit complete — ✅ Execute 7 safe tasks / ⏭ Skip"
        ↓
[You tap ✅ Execute]
        ↓
aider runs in a Docker container with AI provider's API
Heartbeat every 2 min: "Agent working on task 3/7 — 4m elapsed"
        ↓
Branch pushed → PR opened on GitHub
        ↓
[You merge the PR on GitHub]
        ↓
GitHub webhook (pull_request closed + merged)
        ↓
Tasks marked done → next batch starts automatically
        ↓
Sprint velocity updated → leaderboard → CEO report (Sunday)
```

---

## Agent Roster

| Agent ID | Model | Specialty |
|---|---|---|
| `nvidia` | Nemotron 70B (NVIDIA NIM) | Audits, analysis, portfolio intelligence |
| `qwen_coder` | Qwen 2.5 Coder 32B (NVIDIA) | Code implementation, PR author |
| `qwen_coder_dash` | Qwen 2.5 Coder (DashScope) | Code tasks (DashScope tier) |
| `qwen_max` | Qwen Max (DashScope) | Strong reasoning, complex tasks |
| `qwen_turbo` | Qwen Turbo (DashScope) | Bulk low-complexity tasks |
| `gemini` | Gemini 2.5 Pro | Debugging, log analysis, creative |
| `deepseek` | DeepSeek Coder | Cheap fallback, routine tasks |
| `llama_fast` | Llama 3.1 8B (NVIDIA) | Ultra-fast, low-complexity batch |

Builder fallback chain: if the assigned builder fails, Sentinel automatically retries with the next tier (e.g. nvidia → qwen_coder → gemini → deepseek).

---

## Cross-Repo Coordination

Define dependency pairs via `CROSS_REPO_DEPS` (JSON):
```json
{
  "session-guard": ["tapcash", "AlphonsoEcosystem"],
  "shared-utils": ["tapcash"]
}
```
When `session-guard` is pushed to, Sentinel automatically schedules re-audits for `tapcash` and `AlphonsoEcosystem`.

---

## Self-Scaler

Sentinel auto-adjusts its own workload based on monthly budget:

| Budget usage | Action |
|---|---|
| > 85% | Cuts batch size and daily task limit |
| > 95% | Pauses auto-execution, sends Telegram alert |
| < 50% + large queue | Scales up batch size and daily limit |

---

## Business Intelligence

Set `METRICS_SOURCES` to pull real metrics into the priority engine:
```json
[
  { "name": "tapcash", "repo": "tapcash", "url": "https://your-metrics-api/tapcash", "auth": "Bearer xxx" }
]
```
Metrics feed the CEO report, priority engine, and ROI scorer.

---

## Security

- Every High-risk push (auth files, env files, secrets) triggers an immediate security scan
- Full security scans run after every passing build
- Monthly security posture report sent automatically
- `/sentinel security-patch <repo>` auto-fixes safe issues and opens a PR

---

## Tests

```bash
cd backend
npm test          # 37 tests
npm run test:coverage
```

Tests cover: payload extraction, webhook signature validation, PR event handling (merge/reject), Notion matching, risk assessment.

---

## File Structure

```
backend/
├── src/
│   ├── index.js                 # App entry, startup probes, schema init
│   ├── webhook.js               # GitHub push + PR event handler
│   ├── workers.js               # BullMQ cron workers (daily, sprint, build-poll)
│   ├── auditOrchestrator.js     # Audit → tasks → execution flow
│   ├── taskBuilder.js           # aider task execution with heartbeat
│   ├── builderRouter.js         # AI provider selection + fallback chain
│   ├── selfScaler.js            # Budget-aware auto-scaling
│   ├── crossRepoCoordinator.js  # Dependency-triggered cross-repo audits
│   ├── telegramCommands.js      # All /sentinel commands
│   ├── telegramAI.js            # NL understanding + agent routing
│   ├── sprintPlanner.js         # Weekly sprint proposal generation
│   ├── notionClient.js          # Notion API (two-pass project matching)
│   ├── securityScanner.js       # Security scanning pipeline
│   ├── metricsFetcher.js        # Configurable HTTP metrics connector
│   ├── conversationMemory.js    # 7-day conversation history per topic
│   └── ...
├── test/
│   ├── extractPayload.test.js
│   ├── webhook.test.js          # Includes PR merge/reject tests
│   ├── notionClient.test.js
│   └── riskAssessor.test.js
├── Dockerfile
└── railway.toml
```

---

## License

Private — all rights reserved.
