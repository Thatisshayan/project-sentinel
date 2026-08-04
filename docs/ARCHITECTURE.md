# Architecture

## System overview

```
GitHub (push/PR) ──webhook──▶ Sentinel Backend (Express/Node.js)
                                        │
                          ┌─────────────┼─────────────┐
                          ▼             ▼             ▼
                    PostgreSQL       Redis/BullMQ   Telegram Bot
                    (data store)     (job queue)    (commands + alerts)
                          │             │
                          └──────┬──────┘
                                 ▼
                          AI Agent Pool
                  (NVIDIA/Gemini/Mistral/OpenRouter)
                          aider (code execution)
                                 │
                          GitHub PRs (auto-filed)
                                 │
              Sentinel UI (Next.js, self-hosted on Oracle Cloud —
                     see docs/ORACLE_DEPLOY.md)
```

## Core components

### Backend (`backend/src/`)

| Module | Purpose |
|--------|---------|
| `index.ts` | Server entry, startup validation, worker bootstrap |
| `webhook.ts` + `webhook/` | GitHub webhook handler — parses push/PR/CodeRabbit-comment events |
| `auditOrchestrator.ts` | Runs code audits, stores tasks, triggers execution |
| `claudeCodeAudit.ts` | AI-powered code audit via the shared provider chain (`ai/client.ts` — NVIDIA first; Claude only if `ANTHROPIC_API_KEY` is set, which it isn't by default) |
| `workers.ts` + `workers/` | BullMQ workers: build-poll, daily-report, sprint, agent-cleanup |
| `portfolioAnalytics.ts` | Aggregates health scores across all repos |
| `portfolioDb.ts` | Portfolio metrics persistence (portfolio_metrics table) |
| `sprintPlanner.ts` | AI-generated weekly sprint proposals |
| `sprintOrchestrator.ts` | Executes approved sprint tasks |
| `sentinelBrain.ts` | Daily strategic AI decision-making layer |
| `telegramCommands.ts` | Thin router for `/sentinel` commands |
| `commands/` | Command sub-modules (reports, sprint, agents, repoOps, roundtable) |
| `agentDb.ts` | Agent registry — tracks agent status and task history |
| `repoResolver.ts` | `GITHUB_ORG`-aware repo name resolution |
| `aiOutputValidator.ts` | Structural validation for AI JSON outputs |
| `integrationsStatus.ts` | Live health probes for GitHub/Telegram/Notion/self-hosted-VM health |

### UI (`ui/`)

Next.js 14 App Router, server components, Tailwind CSS.

| Route | Purpose |
|-------|---------|
| `/` | Portfolio overview — health, agents, costs |
| `/repos` | Repo list — health, security, build status |
| `/repos/[name]` | Per-repo detail — audit tasks (status-filterable) and project memory (add/delete) |
| `/agents` | Agent status panel |
| `/sprint` | Sprint board — current and upcoming |
| `/security` | Security scores and open issues |
| `/connectors` | Integration health (live API probes) |
| `/settings` | System configuration display |

## Data flow

### Webhook → Audit → Execute → PR

1. GitHub push event → `POST /webhook/github`
2. `webhook.ts` deduplicates (Redis, see `deduplication.ts`), updates Notion, enqueues build-poll job
3. Build-poll worker (`buildPoller.ts`) monitors that repo's own CI/deploy status (GitHub Actions, Vercel, or Railway — whichever the watched repo uses; unrelated to Sentinel's own hosting, which is Oracle Cloud, see `docs/ORACLE_DEPLOY.md`); on success/fail → refreshes portfolio_metrics
4. `auditOrchestrator` triggers AI audit → stores tasks in audit_tasks
5. Safe tasks auto-execute via `taskBuilder` + aider
6. Successful aider run → `git push` + GitHub PR filed
7. PR merged → webhook marks tasks done, updates velocity_metrics

### Daily rhythm

- **06:00** — `sendDailyReport` sends portfolio health summary to Telegram
- **08:00** — `runStrategicBrain` makes daily focus decision
- **Sunday 20:00** — `generateSprintProposal` proposes next week's sprint
- **On demand** — `/sentinel brain`, `/sentinel audit <repo>`, etc.

## Database schema (key tables)

| Table | Purpose |
|-------|---------|
| — | Webhook dedup is Redis-based now (`deduplication.ts`, `sentinel:dedup:<repo>:<sha>` keys, 10min TTL), not a Postgres table — this row previously named a `processed_commits` table that no longer exists. |
| `portfolio_metrics` | Per-repo health snapshots (time series) |
| `audit_tasks` | AI-generated improvement tasks |
| `build_poll_jobs` | Build monitoring job records |
| `debug_attempts` | Build failure debug history |
| `agent_registry` | Live agent status |
| `sprints` | Weekly sprint records |
| `sprint_tasks` | Individual sprint task assignments |
| `velocity_metrics` | Week-over-week velocity data |
| `brain_decisions` | Daily strategic decisions + outcomes |
| `security_scores` | Per-repo security scores |
| `security_issues` | Individual security findings |

## Environment variables

See `backend/.env.example` for the full list. Key groups:

- **Required**: `GITHUB_WEBHOOK_SECRET`, `GITHUB_ORG`, `NOTION_API_KEY`, `NOTION_DATABASE_ID`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `DEBUGGER_SHARED_SECRET`
- **Required in production**: `SENTINEL_UI_KEY`
- **Phase 2 (optional)**: `DATABASE_URL`, `REDIS_URL`, `GITHUB_TOKEN`
- **AI providers** (at least one required): `NVIDIA_API_KEY` (optionally `NVIDIA_API_KEY_2`..`_10` — see `utils/nvidiaKeyPool.ts`), `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`. `DASHSCOPE_API_KEY`/`DEEPSEEK_API_KEY` are still read by `ai/client.ts`'s fallback chain but have no corresponding entry in `builderRouter.ts`'s builder pool — those providers were dropped from the pool 2026-07-29.
