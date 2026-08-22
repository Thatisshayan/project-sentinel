# Project Sentinel

> **Status:** actively evolving. The canonical, continuously-updated log of
> what's shipped vs. designed-only is
> `docs/2026-07-22-slack-agent-roster-plan.md` (Slack transport, CodeRabbit
> ingestion, external agent roster, Viktor authority, roundtable) — read its
> "Implementation log" section first for anything Slack/agent-related.
> Architecture/tech-debt tracking (TypeScript migration, error handling,
> security hardening) lives separately in `STATUS.md` / `AGENTS.md`.
> Archived handoffs and phase snapshots now live under `docs/archive/`.

An autonomous DevOps AI that manages a portfolio of GitHub repositories for a solo founder. Sentinel monitors commits, audits code, generates improvement tasks, executes them via AI agents, opens PRs, and reports business intelligence — through **both Telegram and Slack**, and can dispatch work to a roster of external Slack-native AI agents alongside its own internal ones.

---

## What it does

1. **Watches** every push across the portfolio via GitHub webhooks
2. **Audits** code — CodeRabbit is the primary engine (via its own GitHub App, ingested from PR review comments); Sentinel's own NVIDIA-NIM-based audit runs as a delayed fallback if CodeRabbit never responds
3. **Executes** safe tasks automatically using [aider](https://aider.chat) with your chosen AI provider
4. **Opens PRs** for completed tasks; tracks merge/reject status
5. **Reports** daily portfolio health, CEO-level summaries, security posture, sprint velocity
6. **Coordinates** its own internal AI-model agents in a Telegram group, and dispatches to a roster of *external* Slack-native agents (Kilo, Devin, Manus, Viktor, Claude, Codex, Hermes, Replit) via `@mention` in each repo's Slack channel
7. **Commands work identically from Telegram and Slack** — verb-first syntax (`audit costpilot`, `sprint status`), no prefix required

No Anthropic API required for the core loop. Everything runs on free/cheap AI providers: NVIDIA NIM, Gemini, DashScope Qwen, DeepSeek.

---

## Architecture

```
GitHub webhooks                              Slack (Events API + Interactivity)
      │                                              │
      ▼                                              ▼
Self-hosted (Node.js + Express, full TypeScript)  ◄──────┘
      │
      ├── Webhook handler       → extracts commit, finds Notion project, updates dashboard
      ├── CodeRabbit ingestion  → PR review comments → audit_tasks (primary audit path)
      ├── Audit engine (fallback) → NVIDIA NIM generates tasks as JSON, only if CodeRabbit
      │                             never responds within the fallback delay
      ├── Task queue            → PostgreSQL (audit_tasks) + Redis/BullMQ
      ├── Builder agents        → aider CLI with pluggable AI providers
      ├── PR creator            → GitHub API opens PRs, tracks outcomes
      ├── Sprint planner        → weekly AI-generated sprint proposals
      ├── Security scanner      → dependency + secret + OWASP scanning on every push
      ├── Self-scaler           → auto-adjusts batch size based on budget burn rate
      ├── Cross-repo coord      → triggers dependent repo audits
      ├── commandRegistry       → verb-first command dispatch, shared by both transports
      ├── Telegram bot          → commands, inline menus, multi-agent room, conversation memory
      ├── Slack transport       → outbound fan-out (repoName → channel), inbound @mention +
      │                          Block Kit buttons, same command dispatch as Telegram
      ├── External agent roster → dispatch/reply-correlation to Kilo, Devin, Manus, Viktor,
      │                          Claude, Codex, Hermes, Replit via Slack @mention
      ├── Viktor authority       → bounded, audited, fail-closed delegate actions (approve
      │                          sprint / security patch / delegate) triggered by Viktor's
      │                          own Slack messages
      └── Roundtable            → fans a question out to a repo's agents, collects replies,
                                   synthesizes via LLM, posts back to the thread
            │
            └── Per-agent bots (Nemotron, Qwen, Gemini, DeepSeek, Qwen Dash)
```

**Stack:** Node.js 20 · TypeScript · Express · PostgreSQL · Redis · BullMQ · aider · simple-git · @notionhq/client · Slack Web API + Events API

---

## AI Providers (free-first, Anthropic last resort)

There are two separate provider systems: the **build/aider pool**
(`backend/src/builderRouter.ts` — code-editing tasks, audit-fix, debug-fix)
and the **chat/analysis chain** (`backend/src/ai/client.ts`'s
`callAnyProvider` — audits, security checks, sprint planning, chat replies).
They drifted apart on 2026-07-29 when DashScope/Qwen and DeepSeek-direct were
dropped from the build pool in favor of a wider NVIDIA-hosted model pool
(`backend/src/agentRegistry.ts`'s `AGENT_POOL`) — they're still read by the
chat/analysis chain if configured, just no longer available as a code
builder.

| Provider | Env Var | Used for |
|---|---|---|
| NVIDIA NIM | `NVIDIA_API_KEY` (optionally `NVIDIA_API_KEY_2`..`_10`, see `utils/nvidiaKeyPool.ts`) | Primary builder, audits (fallback), analysis, chat |
| Google Gemini | `GEMINI_API_KEY` | Fallback builder, debugging, chat |
| Mistral | `MISTRAL_API_KEY` | Fallback builder (Codestral — dedicated code model), real cross-provider redundancy |
| OpenRouter | `OPENROUTER_API_KEY` | Fallback builder (free-tier routed models) |
| DashScope (Qwen) | `DASHSCOPE_API_KEY` | Chat/analysis chain only — not in the build pool since 2026-07-29 |
| DeepSeek | `DEEPSEEK_API_KEY` | Chat/analysis chain only — not in the build pool since 2026-07-29 |
| Anthropic | `ANTHROPIC_API_KEY` | Opt-in only, per-caller, in the chat/analysis chain; not in the build pool at all (no `claude` builder entry currently) |

---

## Environment Variables

Full, actively-maintained list with inline explanations: **`backend/.env.example`**.
Highlights by category:

### Required
```
GITHUB_WEBHOOK_SECRET     GitHub webhook signature secret
NOTION_API_KEY            Notion integration token
NOTION_DATABASE_ID        ID of your Projects database in Notion
TELEGRAM_BOT_TOKEN        Main Sentinel bot token (from BotFather)
TELEGRAM_CHAT_ID          Your Telegram group chat ID
DEBUGGER_SHARED_SECRET    Telegram webhook validation secret
GITHUB_ORG                Your GitHub organization or username
```

### Phase 2+ (enable full features)
```
GITHUB_TOKEN              Personal access token (repo + webhook scope)
DATABASE_URL              PostgreSQL connection string
REDIS_URL                 Redis connection string
NVIDIA_API_KEY            NVIDIA NIM API key (primary AI provider)
GEMINI_API_KEY / DASHSCOPE_API_KEY / DEEPSEEK_API_KEY
```

### Slack (see `docs/2026-07-22-slack-agent-roster-plan.md`; archived handoff docs are in `docs/archive/`)
```
SLACK_BOT_TOKEN           Bot token from the Slack app (docs/slack-app-manifest.json)
SLACK_SIGNING_SECRET      Verifies inbound Slack requests
VIKTOR_SLACK_USER_ID      Real Slack user ID for the Viktor external agent — required
                           before Phase 6's authority features do anything at all
SLACK_BOT_ID              Slack bot's own user ID (starts with B...). Used to filter
                           echo-loop messages so Sentinel doesn't treat its own
                           synthesis posts as external agent replies. Get via:
                           curl -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
                                https://slack.com/api/auth.test
ROUNDTABLE_TIMEOUT_MIN    Minutes before an unanswered roundtable forces synthesis (5)
CODERABBIT_FALLBACK_DELAY_MIN  Minutes before Sentinel's own fallback audit runs (45)
```

### Optional (full list in `.env.example`)
```
AGENT_ROOM_TOPIC_ID       Topic ID for #agent-room thread
WATCHED_REPOS             Comma-separated list of repos to auto-onboard
PUBLIC_DOMAIN             This host's public domain; used for webhook URLs
AUDIT_AGENT_ENABLED       Set to false to disable automatic audits (default: true)
BUILDER_AGENT_ENABLED     Set to false to disable task execution (default: true)
TASK_BATCH_SIZE           Tasks per execution batch (default: 5)
MAX_BUILDER_TASKS_PER_DAY Max tasks executed per day per repo (default: 10)
SPRINT_MONTHLY_BUDGET     Monthly AI spend budget in USD (default: 30)
CROSS_REPO_DEPS           JSON dependency map for cross-repo audit triggers
METRICS_SOURCES           JSON array of HTTP metric connectors for business data
AUDIT_COOLDOWN_HOURS      Hours between audits per repo (default: 12)
SENTRY_DSN                Sentry error monitoring (optional)
```

---

## Deployment (self-hosted)

Runs as a Docker Compose stack (Postgres, Redis, backend, UI, Caddy for
TLS) on a single host — currently an Oracle Cloud Always Free VM. Full
setup steps, including DNS, firewall, and env config, are in
[`docs/ORACLE_DEPLOY.md`](docs/ORACLE_DEPLOY.md); short version:

1. Clone the repo onto the host, fill in `backend/.env` and `ui/.env` from their `.env.example` files, make sure `backend/.env` includes `GITHUB_TOKEN`, run `bash scripts/check_prod_runtime.sh`, and `docker login ghcr.io` (images are built in CI, not on the host — see `docs/ORACLE_DEPLOY.md`)
2. `docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d && bash scripts/prod_smoke.sh`
3. Set up GitHub webhooks for each repo (done automatically for repos onboarded after Slack existed; see `repoOnboarder.ts`):
   - URL: `https://<PUBLIC_DOMAIN>/webhook/github`
   - Events: **Push**, **Pull request**, **Pull request review comment** (the last one is how CodeRabbit's findings arrive)
   - Secret: same as `GITHUB_WEBHOOK_SECRET`
4. Create the Slack app from `docs/slack-app-manifest.json` (App Manifest tab at api.slack.com/apps), install it to your workspace, and set `SLACK_BOT_TOKEN`/`SLACK_SIGNING_SECRET`

The Dockerfile installs Node.js 20, Python 3, Git, and aider. The app starts on port 3000 after runtime bootstrap completes (schema init, workers, startup probes). Caddy reverse-proxies webhook and health/readiness routes to it — see `Caddyfile`.

Backend schema changes are now managed through `backend/migrations/*.sql` via `npm run migrate` in `backend/` before startup bootstrap applies the same migration set.

Always verify a deploy actually succeeded rather than assuming a clean `docker compose up` output means the app is actually serving traffic: `docker compose -f docker-compose.prod.yml ps` should show all services `Up`, `curl -I https://<PUBLIC_DOMAIN>/health` should return 200 (liveness), and `curl -I https://<PUBLIC_DOMAIN>/ready` should return 200 (readiness).

---

## Dashboard (UI)

`ui/` is a Next.js 14 (App Router) dashboard — portfolio overview, per-repo detail,
agent status, sprint board, security scores, governance drift visibility for the
Sentinel control repo, and a live agent-room terminal. It
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
`POSTGRES_PASSWORD` (optional, defaults to `sentinel`) controls both the
Postgres container's password and the backend's `DATABASE_URL` — set it in
your shell before running `docker-compose up` if you want a non-default
local password; both are wired to the same value.

### Environment Variables

```
SENTINEL_API_URL   Base URL of the backend, no trailing slash (e.g. http://localhost:3000)
SENTINEL_UI_KEY    Must match the backend's SENTINEL_UI_KEY exactly
```

### API behavior (timeouts & failure handling)

All dashboard data is fetched server-side via `ui/lib/api.ts`, which proxies to
the backend `/api/*` routes. The `api()` helper enforces an **8-second timeout**
(`AbortController`) so a slow or unreachable backend fails fast instead of
hanging a server-component render indefinitely. If `SENTINEL_API_URL` is unset,
`api()` throws an `ApiConfigError` immediately. Pages wrap each fetch in
`try/catch` and render an empty state on failure — the dashboard never blocks
on a slow backend. Timeouts surface as `ApiTimeoutError` (extending `Error`
with `name = 'ApiTimeoutError'`) so callers can distinguish them from other
failures without parsing message text.

### Deployment (self-hosted)

Deploys as part of the same Docker Compose stack as the backend — see
[`docs/ORACLE_DEPLOY.md`](docs/ORACLE_DEPLOY.md). `docker-compose.prod.yml`
sets `SENTINEL_API_URL` to the backend container's internal address
automatically; you only need to set `SENTINEL_UI_KEY` in `ui/.env` to match
the backend's value.

---

## Commands — Telegram and Slack (identical syntax)

Verb-first, no `/sentinel` prefix needed (legacy `/sentinel <subcommand>` syntax still works). In Slack, `@mention` the bot with the same text; in Telegram, just type it in the group.

### Core
| Command | What it does |
|---|---|
| `audit <repo>` | Force a fresh audit — generates tasks (validated against the real tracked-repo list first) |
| `execute <repo>` | Start executing queued tasks |
| `execute force <repo>` | Unlock all tasks (including unsafe) and execute |
| `stop <repo>` | Stop all activity on a repo |
| `tasks <repo>` | List queued tasks |
| `status <repo>` | Current build + task status |

### Reports
| Command | What it does |
|---|---|
| `report` | Send daily portfolio report |
| `dashboard` | Live status card (health, agents, budget) |
| `health` | Portfolio health scores for all repos |
| `weekly` | Weekly business + tech report |
| `ceo` | Generate CEO-level summary |
| `velocity` | Sprint velocity trend |
| `costs` | API spend breakdown |
| `business <repo>` | Business metrics for a repo |
| `security <repo>` | Security posture for a repo |
| `patterns` | Cross-repo pattern analysis |
| `impact <repo>` | PR impact analysis |

### Sprint
| Command | What it does |
|---|---|
| `sprint propose` | Generate weekly sprint proposal |
| `sprint approve` | Approve the pending sprint |
| `sprint skip` | Skip this week's sprint |
| `sprint status` | Current sprint progress |
| `sprint run` | Resume sprint execution |
| `sprint pause` | Pause sprint |

### Agents (internal AI-model roster)
| Command | What it does |
|---|---|
| `agents` | Show all agents and current status |
| `active` | What are agents doing right now? |
| `standup` | Run agent standup (7-day real stats) |
| `leaderboard` | Post agent performance leaderboard |
| `bots test` | Test all configured agent bots |
| `bots` | Show configured vs. missing bot tokens |

### External agent roster (Slack-native — Kilo, Devin, Manus, Viktor, Claude, Codex, Hermes, Replit)
| Command | What it does |
|---|---|
| `assign <agent-id> <repo> <task>` | Dispatch a task to an external agent via `@mention` in the repo's channel |
| `roundtable <repo> <question>` | Fan a question out to the repo's agents, collect replies, post a synthesized summary |
| `viktor log [repo]` | View Viktor's recent authority-log decisions (approved/denied/executed) |
| `viktor rules` | View the current Viktor authority allow-list (all disabled by default) |

### System
| Command | What it does |
|---|---|
| `webhook status` | Which repos are sending webhook events |
| `self audit` | Run Sentinel self-audit |
| `self approve` | Approve Sentinel's own improvement tasks |
| `lock <repo>` | Lock a repo (no agents will touch it) |
| `unlock <repo>` | Unlock a repo |
| `security scan <repo>` | Run security scan manually |
| `security approve <repo>` | Resolve all open security issues for a repo |
| `memory` | Show last 10 conversation exchanges |
| `pause` / `resume` | Pause/resume all automation — also gates Viktor's authority path |
| `help` | Interactive command menu |

---

## Legacy Telegram Quick Reference

The old manual’s Telegram behavior is still supported:

- Slash commands still work with or without the legacy `/sentinel` prefix.
- Natural language still routes to the right action, for example `audit tapcash` or `show me the costs`.
- Replying to any bot or agent message sends that reply back to the same agent.
- The agent room remains the shared coordination space for the internal bots.

### Agent Room Rules

- All internal agents post in `#agent-room`
- Daily standup is at 9am Toronto
- Weekly leaderboard is Sunday 10:30pm Toronto
- General messages are routed to the best-fit agent automatically

### Emergency Procedures

| Situation | Command |
|---|---|
| Agent doing something wrong | `stop <repo>` |
| Sprint about to execute something you do not want | `sprint skip` |
| Auto-approve about to fire | `pause` |
| Do not want Sentinel touching a repo | `lock <repo>` |
| Stop everything | `pause` |

### Quick Env Reminders

- See the "Environment Variables" section above (`Required` / `Phase 2+` / `Optional`) for the canonical, current list — don't rely on any older env-var list elsewhere.
- Agent bot tokens and topic IDs are configured through environment variables.

### Natural language (Telegram only — free-text AI routing)
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
CodeRabbit reviews the PR (its own GitHub App) → findings ingested via PR review
comments → audit_tasks. If CodeRabbit never responds within the fallback delay,
Sentinel's own NVIDIA NIM audit runs instead.
        ↓
Tasks saved to PostgreSQL + Notion
        ↓
Telegram + Slack: "Audit complete — ✅ Execute N safe tasks / ⏭ Skip"
        ↓
[You tap ✅ Execute — works identically in both platforms]
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

## Internal Agent Roster (AI models, dispatched via aider/Claude Code)

| Agent ID | Model | Specialty |
|---|---|---|
| `nvidia` | Nemotron 70B (NVIDIA NIM) | Audits (fallback), analysis, portfolio intelligence |
| `qwen_coder` | Qwen 2.5 Coder 32B (NVIDIA) | Code implementation, PR author |
| `qwen_coder_dash` | Qwen 2.5 Coder (DashScope) | Code tasks (DashScope tier) |
| `qwen_max` | Qwen Max (DashScope) | Strong reasoning, complex tasks |
| `qwen_turbo` | Qwen Turbo (DashScope) | Bulk low-complexity tasks |
| `gemini` | Gemini 2.5 Pro | Debugging, log analysis, creative |
| `deepseek` | DeepSeek Coder | Cheap fallback, routine tasks |
| `llama_fast` | Llama 3.1 8B (NVIDIA) | Ultra-fast, low-complexity batch |

Builder fallback chain: if the assigned builder fails, Sentinel automatically retries with the next tier.

## External Agent Roster (Slack-native, dispatched via `@mention`)

A DATA-driven roster (`external_agents` table) — adding a new agent is an `INSERT`, not a new file. Currently seeded:

| Agent | Slack handle | Role |
|---|---|---|
| Kilo | `@kilo` | worker |
| Viktor | `@viktor` | authority (see Viktor Authority below) |
| Devin | `@devin` | worker |
| Manus | `@manus` | worker |
| CodeRabbit | `@coderabbit` | auditor (primary audit engine, invoked via its own GitHub App, not `@mention`) |
| Claude | `@claude` | worker |
| Codex | `@codex` | worker |
| Hermes | `@hermes` | assistant |
| Replit | `@replit` | worker |

### Viktor Authority

Viktor can trigger real production actions from a Slack message — approve a sprint, approve security patches, or delegate a task to another agent — but only within an explicit, per-action-type allow-list (`viktor_authority` table, **every row ships disabled by default**), and every attempt (approved or denied) is logged to `agent_authority_log`. `pause`/`resume` gate this path too. Requires `VIKTOR_SLACK_USER_ID` to be configured (real Slack user ID) — unconfigured means completely inert.

### Roundtable

`roundtable <repo> <question>` fans a question out to a repo's enabled worker agents via one `@mention` message, collects replies (5-minute timeout forces a synthesis regardless), and posts an LLM-generated synthesis (agreement / disagreement / recommended path) back into the thread.

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

- Every high-risk push (auth files, env files, secrets) triggers an immediate security scan
- Full security scans run after every passing build
- Monthly security posture report sent automatically
- `security patch <repo>` auto-fixes safe issues and opens a PR
- Snyk is also connected via its own GitHub webhook on several repos (not yet integrated into Sentinel's own reporting)

---

## Tests

```bash
cd backend
npm test          # 53 suites / 431+ tests
npx tsc --noEmit  # type-check, should be clean
```

```bash
cd ui
npm run build     # also type-checks the UI
```

---

## File Structure

```
backend/
├── src/
│   ├── index.ts                    # App entry, startup probes, schema init
│   ├── webhook.ts                  # GitHub webhook router
│   ├── webhook/                    # push / PR / CodeRabbit event handlers
│   ├── commandRegistry.ts          # Verb-first command dispatch, shared by Telegram + Slack
│   ├── slackClient.ts              # Outbound Slack (chat.postMessage, buttons, channel creation)
│   ├── slackEvents.ts              # Inbound Slack Events API (@mention, message events)
│   ├── slackInteractions.ts        # Slack Block Kit button click handling
│   ├── viktorAuthority.ts          # Viktor's bounded, audited authority allow-list
│   ├── agents/
│   │   ├── externalAgentRegistry.ts  # External agent roster + dispatch/reply-correlation
│   │   ├── viktorWatcher.ts          # Inbound Viktor authority-action recognition
│   │   └── roundtable.ts             # Multi-agent fan-out/collect/synthesize
│   ├── commands/                   # agents.ts, repoOps.ts, reports.ts, sprint.ts, roundtable.ts
│   ├── workers/                    # buildPollWorker, dailyReportWorker, sprintWorker,
│   │                                #   agentCleanupWorker, scheduledJobsWorker (BullMQ)
│   ├── auditOrchestrator.ts        # Audit → tasks → execution flow (also posts results to GitHub)
│   ├── taskBuilder.ts              # aider task execution with heartbeat
│   ├── builderRouter.ts            # AI provider selection + fallback chain
│   ├── selfScaler.ts               # Budget-aware auto-scaling
│   ├── telegramCommands.ts         # Legacy /sentinel command handling + AI-routed free text
│   ├── telegramAI.ts               # NL understanding + agent routing
│   ├── sprintOrchestrator.ts       # Sprint approve/pause/resume/execution
│   ├── notionClient.ts             # Notion API (two-pass project matching)
│   ├── securityScanner.ts          # Security scanning pipeline
│   └── ...                         # ~90 files total, all TypeScript — no .js remains
├── scripts/                        # One-off standalone diagnostic/backfill scripts (not TS-built)
├── test/                           # 53 test files (.ts and .js), 431+ tests
└── Dockerfile

ui/                                 # Next.js 14 dashboard, see "Dashboard (UI)" above

docker-compose.prod.yml             # Production stack (postgres/redis/backend/ui/caddy) — see docs/ORACLE_DEPLOY.md
Caddyfile                           # Reverse proxy + TLS config for docker-compose.prod.yml

docs/
├── ORACLE_DEPLOY.md                         # Self-hosted deploy guide (Oracle Cloud Always Free VM)
├── 2026-07-22-slack-agent-roster-plan.md   # Living plan + implementation log — read first
└── slack-app-manifest.json                 # Used to create the Slack app
```

---

## License

Private — all rights reserved.
