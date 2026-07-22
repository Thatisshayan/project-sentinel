# Project Sentinel — Agent Rules

This file is the first-stop instruction set for any agent working in this repository.

## Mandatory Read Order

Before planning, editing, or reporting completion, every agent must read:

1. **[Baseline Rules](#baseline)** — Foundational agent rules (adapted from RemoteCliControl)
2. [STATUS.md](./STATUS.md) — current project state
3. [docs/superpowers/plans/2026-07-16-sentinel-rebuild.md](./docs/superpowers/plans/2026-07-16-sentinel-rebuild.md) — active rebuild plan
4. [CONTRIBUTING.md](./CONTRIBUTING.md) (if exists)
5. The phase-specific documentation below

## Baseline

All repositories follow the foundational agent rules established in the RemoteCliControl project:

- Keep docs findable and current while work is in progress
- Do not claim completion without verification
- Do not silently skip requested steps
- Record deferred work in appropriate documentation
- Keep the repo stable, review existing failures, and report what was pre-existing
- Code changes must be actually applied and tested
- Documentation must be updated in the same pass as code changes
- Verification must be run (or concrete blockers reported)

For full details, see [RemoteCliControl/AGENTS.md](../RemoteCliControl/AGENTS.md).

## Project Sentinel-Specific Context

**Two separate "phase" tracks exist in this repo's docs — don't conflate them:**
1. **Architecture/tech-debt track** (`STATUS.md`, this section below): TypeScript migration, error architecture, security hardening, test coverage, catch-pattern elimination, architecture refactoring. Phases 0-5 complete as of 2026-07-19; 6-7 were in progress as of that date — re-check `STATUS.md` directly before trusting its %-complete figures past a quick skim, they may be stale.
2. **Slack + external-agent-roster track** (`docs/2026-07-22-slack-agent-roster-plan.md`): a completely different Phase 0-7 numbering, covering command-layer unification, Slack transport, CodeRabbit-as-primary-audit-engine, the external agent roster (Kilo/Devin/Manus/Viktor/Claude/Codex/Hermes/Replit), Viktor's bounded authority, and the multi-agent roundtable. As of 2026-07-22 this track's Phases 0-7 are all code-complete and unit-tested — **read that doc's "Implementation log" section for the real, current status**, including what's genuinely verified live vs. still unverified (Slack event delivery to `/webhook/slack/events` was confirmed working live in production on 2026-07-22, closing the single longest-standing open question in that doc).

**Key Notes** (architecture track):
- Full TypeScript migration complete (2026-07-17) — **no `.js` files remain in `backend/src/`**; do not reference `.js` paths from memory or older docs.
- Phase 6 (webhook.ts/workers.ts split, inline require() → top-level imports) complete
- Phase 7 audit (2026-07-18): verified Phase 3-6 claims against actual code, not commit messages. Found and fixed: a documented-but-nonexistent dead-letter queue, an unenforced coverage gate, residual silent `catch {}` swallows, 0%-covered worker files, and unscoped child-process env in package-install exec calls. See `docs/governance/DEFERRED_WORK.md` for the full trace.
- `backend/.env.example` now includes the Slack/agent-roster env vars added 2026-07-22 (`SLACK_BOT_TOKEN`, `VIKTOR_SLACK_USER_ID`, `ROUNDTABLE_TIMEOUT_MIN`, etc.) — was previously significantly behind actual env var usage.
- `timingSafeEqual`'s length-check has a low-severity timing side-channel (still open, tracked, not blocking).
- Full test suite as of 2026-07-22: 53 files, 431+ tests, `tsc --noEmit` clean across both `backend/` and `ui/`.

---

# Agents

Project Sentinel uses a pool of AI agents to perform code audits, fixes, and portfolio management. Each agent corresponds to a specific AI provider and model.

## Agent pool

| Agent ID | Provider | Model | Role |
|----------|----------|-------|------|
| `nvidia` | NVIDIA NIM | `meta/llama-3.1-70b-instruct` | Primary auditor + builder |
| `gemini` | Google Gemini | `gemini-2.0-flash` | Sprint planning + reports |
| `qwen_max` | DashScope (Alibaba) | `qwen-max` | Sprint planning fallback |
| `qwen_coder` | NVIDIA NIM | `meta/llama-3.1-70b-instruct` | Code-focused builds (primary builder) |
| `qwen_coder_dash` | DashScope | `qwen2.5-coder-32b-instruct` | Code-focused builds (DashScope fallback) |
| `deepseek` | DeepSeek | `deepseek-chat` | Strategy (brain) |
| `llama_fast` | NVIDIA NIM | `meta/llama-3.1-8b-instruct` | Fast audit tasks |

> **NVIDIA NIM model note:** this project's NIM key is only entitled to a
> narrow set of models. Confirmed working: `meta/llama-3.1-70b-instruct`,
> `meta/llama-3.1-8b-instruct`, `mistralai/mistral-nemotron`. Confirmed
> **not** available on this key (HTTP 404, or hangs until timeout):
> `nvidia/llama-3.1-nemotron-70b-instruct`, `meta/llama-3.3-70b-instruct`,
> `mistralai/codestral-22b-instruct-v0.1`, `deepseek-ai/deepseek-coder-6.7b-instruct`,
> `ibm/granite-*-code-instruct`, `bigcode/starcoder2-15b`, and
> `qwen/qwen2.5-coder-32b-instruct` (EOL'd by NVIDIA 2026-05-12, HTTP 410).
> Before changing any NIM model default, verify with a direct curl to
> `https://integrate.api.nvidia.com/v1/chat/completions` first — a model
> being in NIM's public catalog does not mean this key can call it. Also
> avoid Nemotron reasoning models with Aider: they return `content: null`
> and put output in `reasoning_content`/`<think>` blocks instead, which
> breaks both Aider's diff parsing and this codebase's `message.content`
> parsing (`ceoReport.ts`, `sentinelBrain.ts`, `sprintPlanner.ts`,
> `telegramAI.ts`, `claudeCodeAudit.ts`).

## Configuration

Each agent is activated by setting its provider's API key in Railway (or your `.env` file):

| Key | Activates |
|-----|-----------|
| `NVIDIA_API_KEY` | nvidia, llama_fast, qwen_coder (via NIM) |
| `GEMINI_API_KEY` | gemini |
| `DASHSCOPE_API_KEY` | qwen_max, qwen_coder_dash, qwen_turbo |
| `DEEPSEEK_API_KEY` | deepseek |

If multiple providers are configured, Sentinel chooses the best fit for each task based on `AIDER_MODEL` and capacity settings.

## Agent bots (optional)

Each agent can send Telegram messages under its own bot identity. Configure with `BOT_TOKEN_<AGENTNAME>` (e.g., `BOT_TOKEN_NVIDIA`). Without these, all messages come from the primary bot. Use `/sentinel bots` to see configuration status.

## Priority chain for each operation

| Operation | Primary | Fallbacks |
|-----------|---------|-----------|
| Audit | NVIDIA NIM (`mistralai/mistral-nemotron`) | Claude Code (aider) |
| Sprint planning | NVIDIA NIM (`mistralai/mistral-nemotron`) | Gemini → DashScope → DeepSeek |
| Strategic brain | NVIDIA NIM (`mistralai/mistral-nemotron`) | DeepSeek |
| Build repair (aider) | NVIDIA NIM (`meta/llama-3.1-70b-instruct`, via `AIDER_MODEL`) | Gemini → DashScope → DeepSeek (see `builderRouter.ts` `FALLBACK_CHAIN`) |

## Status monitoring

- `agents` — current status of all registered agents (works from Telegram or Slack)
- `active` — agents currently working on a task
- `leaderboard` — weekly performance ranking
- Agent errors surface in the UI agents panel and via Telegram startup alerts

## External agent roster (Slack-native, separate from the internal AI-model pool above)

Added 2026-07-22 — see `docs/2026-07-22-slack-agent-roster-plan.md` for full design/status.
Data-driven (`external_agents` table, `backend/src/agents/externalAgentRegistry.ts`) —
adding an agent is an `INSERT`, not a new file. Dispatched via `@mention` in a repo's
Slack channel (`assign <agent-id> <repo> <task>`), not via this pool's aider/Claude-Code
mechanism.

| Agent | Slack handle | Role |
|---|---|---|
| Kilo | `@kilo` | worker |
| Viktor | `@viktor` | authority — bounded, audited, fail-closed (`viktorAuthority.ts`) |
| Devin | `@devin` | worker |
| Manus | `@manus` | worker |
| CodeRabbit | `@coderabbit` | auditor — primary audit engine, via its own GitHub App |
| Claude | `@claude` | worker |
| Codex | `@codex` | worker |
| Hermes | `@hermes` | assistant |
| Replit | `@replit` | worker |

`roundtable <repo> <question>` fans a question out to a repo's agents and posts a
synthesized reply (`backend/src/agents/roundtable.ts`).
