# Project Sentinel — User Manual

Sentinel is your autonomous DevOps AI. It monitors 12 GitHub repos, runs code audits, creates PRs, tracks business metrics, and coordinates a team of 8 AI agents — all via Telegram.

---

## How to talk to Sentinel

Send any message in your Telegram group. Sentinel listens everywhere.

- **Slash commands** (`/sentinel <command>`) — direct actions, always execute
- **Natural language** — Sentinel reads intent and acts. "Audit tapcash" = `/sentinel audit tapcash`
- **Reply to a bot** — replying to any agent bot message routes that message directly to that agent

---

## The 8 Agents

| Bot | Agent ID | Personality | Best for |
|---|---|---|---|
| @nemotronsintelbot | `nvidia` | Precise, analytical | Audits, reports, analysis |
| @qwencodersintenelbot | `qwen_coder` | Terse, code-first | Building features, PRs |
| @qwendashsentinelbot | `qwen_coder_dash` | Fast executor | Simple tasks, delegated work |
| @geminisentinelbot | `gemini` | Thorough, edge-cases | Debugging, deep reviews |
| @deepseeksentinelBot | `deepseek` | Reliable fallback | General tasks |
| — | `qwen_max` | Heavy lifter | Complex reasoning |
| — | `qwen_turbo` | Speed | Quick lookups |
| — | `llama_fast` | Casual, fast | Lightweight tasks |

Agents speak with their own bot tokens in the agent-room topic. Sentinel routes messages to the right agent based on content: code questions → Qwen Coder, analysis → Nemotron, debugging → Gemini.

---

## Command Reference

### Reports & Data
```
/sentinel report           Daily portfolio report (health, builds, costs)
/sentinel weekly           Weekly business + technical summary
/sentinel ceo              CEO founder-style weekly update
/sentinel costs            AI API spend today + this month
/sentinel health           All 12 repos health scores (worst first)
/sentinel velocity         Sprint velocity trend (last 2 weeks)
/sentinel patterns         Cross-repo patterns Sentinel detected
/sentinel business <repo>  Business metrics for a specific repo
/sentinel impact <repo>    PR impact analysis (revenue/UX delta)
/sentinel roi              Recalculate ROI scores for all queued tasks
```

### Agents & Bots
```
/sentinel agents           Show all 8 agents and their current status
/sentinel what             Who is working right now and on what
/sentinel standup          Trigger agent standup immediately (normally 9am)
/sentinel leaderboard      Post weekly agent rankings immediately
/sentinel bots             Show which bot tokens are configured
/sentinel test-bots        Send a test message from each configured bot
/sentinel setup-bots       Update bot descriptions in Telegram
/sentinel memory           Show recent conversation history
```

### Repos & Execution
```
/sentinel audit <repo>          Trigger a fresh code audit
/sentinel tasks <repo>          List queued tasks (up to 12)
/sentinel execute <repo>        Run safe auto-approved tasks
/sentinel force-execute <repo>  Run ALL queued tasks immediately (bypass safety)
/sentinel stop <repo>           Stop all running tasks for a repo
/sentinel skip <repo>           Skip current audit cycle
/sentinel skip-batch <repo> <n> Skip a specific task batch
/sentinel lock <repo>           Lock repo — no agent can touch it
/sentinel unlock <repo>         Remove lock
/sentinel locked                Show all currently locked repos
/sentinel repo <name>           Open interactive repo control panel
/sentinel dashboard             Refresh Notion dashboard
/sentinel status <repo>         Show Notion project info
/sentinel builds <repo>         Check latest build provider status
```

### Sprint & Planning
```
/sentinel propose-sprint   Generate a sprint proposal now (normally Sunday 8pm)
/sentinel approve-sprint   Approve the current proposal and start executing
/sentinel run-sprint       Resume or continue current sprint execution
/sentinel sprint-status    Show sprint progress and task list
/sentinel skip-sprint      Skip this week's sprint
/sentinel pause-sprint     Pause sprint mid-execution
/sentinel resume-sprint    Resume a paused sprint
/sentinel approve          Show all pending approvals as buttons
```

### Security
```
/sentinel security              Portfolio-wide security scores
/sentinel security <repo>       Repo security score + open issues
/sentinel security-scan <repo>  Full scan: secrets, deps, OWASP
/sentinel security-patch <repo> Auto-fix safe dependency issues
/sentinel security-approve <repo> Approve a pending security patch PR
```

### System & Control
```
/sentinel pause            EMERGENCY STOP — halt all automation instantly
/sentinel resume           Restart automation
/sentinel self-audit       Run Sentinel self-check (code + config)
/sentinel self-approve     Execute approved Sentinel improvement tasks
/sentinel performance      AI model success rates + latency
/sentinel prompts          Prompt optimisation report
/sentinel menu             Open quick-action inline keyboard
/sentinel help             Open this interactive command browser
```

---

## How Work Actually Happens

```
You push a commit to GitHub
        ↓
Webhook hits Sentinel → build poll starts
        ↓
Build passes → audit triggered
        ↓
Audit finds issues → tasks written to DB + Notion
        ↓
/sentinel execute <repo>   — run safe tasks
/sentinel force-execute <repo> — run everything
        ↓
AI writes code → PR created on GitHub
        ↓
You review + merge → build passes → cycle repeats
```

**Sprint mode** (weekly):
```
Sunday 8pm → Sprint proposal sent
        ↓
/sentinel approve-sprint   (or auto-approves in 2h if SPRINT_AUTO_APPROVE=true)
        ↓
Tasks execute one by one (priority order)
        ↓
Each task = PR on GitHub → you review → merge
```

---

## Natural Language Examples

These all work without slash commands:

- `"audit tapcash"` → triggers audit
- `"what is nemotron doing?"` → agent status
- `"assign tapcash to qwen_coder"` → reassigns builder
- `"show me the costs"` → cost breakdown
- `"start working on acc"` → executes queued tasks
- `"approve the sprint"` → approves current sprint proposal
- `"stop everything on shiporex"` → stops all tasks

---

## Agent Room Rules

- All 8 agents post in the **#agent-room** topic
- Daily standup at **9am Toronto**
- Weekly leaderboard **Sunday 10:30pm Toronto**
- Reply to any agent message to talk directly to that agent
- General messages are routed to the best-fit agent automatically

---

## Emergency Procedures

| Situation | Command |
|---|---|
| Agent doing something wrong | `/sentinel stop <repo>` |
| Sprint about to execute something you don't want | `/sentinel skip-sprint` |
| Auto-approve about to fire | `/sentinel pause` |
| Don't want Sentinel touching a repo | `/sentinel lock <repo>` |
| Nuclear option — stop everything | `/sentinel pause` |

---

## Environment Variables Quick Reference

**Required**: `GITHUB_WEBHOOK_SECRET`, `GITHUB_TOKEN`, `NOTION_API_KEY`, `NOTION_DATABASE_ID`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `DATABASE_URL`, `REDIS_URL`

**AI (one required)**: `NVIDIA_API_KEY` (recommended), `GEMINI_API_KEY`, `DASHSCOPE_API_KEY`, `DEEPSEEK_API_KEY`

**Agent bots**: `BOT_TOKEN_NEMOTRON`, `BOT_TOKEN_QWEN_CODER`, `BOT_TOKEN_QWEN_DASH`, `BOT_TOKEN_GEMINI`, `BOT_TOKEN_DEEPSEEK`

**Topics**: `AGENT_ROOM_TOPIC_ID`, `TOPIC_TAPCASH`, `TOPIC_ACC`, etc.

**Tuning**: `SPRINT_AUTO_APPROVE=false`, `SPRINT_MONTHLY_BUDGET=50`, `MAX_PARALLEL_AGENTS=3`
