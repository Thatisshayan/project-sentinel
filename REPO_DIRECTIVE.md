# project-sentinel — REPO_DIRECTIVE

> GOAL-LAYER CONSTITUTION for this repo. `REPO_RULES.md` is the law (how to work).
> This file is the mission: what Sentinel IS, what it builds, and what it must NEVER do.
> Every task (docs, TODO, PR, Sentinel-generated) MUST carry `traces-to:` to a defined
> Phase/Sprint/Epic. Orphan tasks are rejected by CI (scripts/verify.sh → directive-lint)
> AND by Sentinel's autoApprover at runtime. This file is itself a live artifact Sentinel
> reads to govern its own work and the work of sub-agents.

## Vision

Project Sentinel is the autonomous build + governance operating system for Shayan's
portfolio. It is a SELF-BUILDING system: it improves itself and builds other repos
through a closed loop — detect change → audit → draft/execute tasks via AI agents →
open PRs → track merge → update ground truth → repeat. Its north-star is zero forgotten
broken commits and a portfolio where every repo's goal (REPO_DIRECTIVE) and law
(REPO_RULES) are enforced automatically, with Shayan as the only human approval gate.

**Command chain (non-negotiable):**
`SHAYAN → HERMES → SENTINEL → sub-agents / dedicated agents`
- SHAYAN: owner; sets intent, approves merges, holds the only override.
- HERMES: personal CTO agent; translates SHAYAN intent into Sentinel directives + audits.
- SENTINEL: executor; runs the loop, enforces REPO_RULES + REPO_DIRECTIVE per repo,
  dispatches to sub-agents, never bypasses the chain.
- sub-agents (aider/Codex/Devin/Manus/Viktor/Hermes-instance/etc.): do the atomic work,
  only on REPO_DIRECTIVE-traced tasks, only on branches, never on `main`.

## Non-Goals

- NOT a general chatbot. Verb-first commands scoped to repo/devops ops.
- NOT replacing CodeRabbit. CodeRabbit is PRIMARY audit; Sentinel audit is fallback-only.
- NOT executing non-traced (orphan) tasks — autoApprover rejects them (this directive's law).
- NOT spending paid API/infra beyond SPRINT_MONTHLY_BUDGET without Shayan approval.
- NOT deleting files or pushing to `main` — ever (REPO_RULES Rule 14, branch-only).
- NOT adopting Anthropic as default provider (last-resort only).
- NOT building a separate UI auth system (server-proxied read surface behind UI key).
- NOT acting outside the SHAYAN→HERMES→SENTINEL→agent chain. No agent self-promotes to owner.

## Phases

### P1 — Foundation & Safety Net (COMPLETE)
  exit: CI green; ESLint/Prettier; execSync→async; structured errors + Sentry; branch protection.
### P2 — TypeScript Migration (COMPLETE)
  exit: zero `.js` in backend/src; `tsc --noEmit` clean; Jest TS transform.
### P3 — Error Architecture (COMPLETE)
  exit: AppError taxonomy + handlers + Sentry v8; no unhandled rejections in prod.
### P4 — Security Hardening (COMPLETE)
  exit: timing-safe compare; DB CA cert; rate-limit; scoped child env; UI proxy allowlist; CSRF.
### P5 — Test Coverage Blitz (COMPLETE — unit only)
  exit: 156 unit tests; safeFire + fireAndForget + DLQ. Integration deferred (no Docker).
### P6 — Architecture Refactoring (IN PROGRESS ~50%)
  exit: god modules split; 6.3 (centralize AI client) done or deferred; 6.5 (UI utils) done.
### P7 — Operational Excellence (PENDING)
  exit: integration suite green; DLQ/retry runtime-verified; live-verified audit loop;
  doc-drift gone; 50% line coverage.
### P8 — Goal-Layer Enforcement (IN PROGRESS — this directive)
  exit: REPO_DIRECTIVE linted in every repo; Sentinel drafts + enforces tracing.
### P9 — Self-Building Loop (THE NORTH-STAR PHASE)
  exit: Sentinel (a) rewrites its OWN REPO_DIRECTIVE from code/docs, (b) proposes +
  executes its own improvement tasks on branches, (c) builds OTHER repos from their
  REPO_DIRECTIVE via sub-agents, all gated by the chain + autoApprover + Viktor.
### P10 — Portfolio Autonomous Ops (FUTURE)
  exit: a repo joins, Sentinel auto-drafts its REPO_DIRECTIVE, enforces it, and runs
  the loop with zero human nudge beyond Shayan's merge approval.

## Sprints

### S1 (maps to P6) — finish arch refactor
  goal: close 6.3 + 6.5 without public-surface breakage.
### S2 (maps to P7) — operational truth
  goal: kill silent failures; integration coverage; fix doc drift.
### S3 (maps to P8) — directive rollout
  goal: every repo has a linted REPO_DIRECTIVE; Sentinel enforces tracing.
### S4 (maps to P9) — self-build
  goal: Sentinel improves itself + builds other repos from directives, chain-gated.
### S5 (maps to P10) — portfolio autonomy
  goal: new repo → auto-directive → auto-loop.

## Epics / Chapters

### E1 — Core Loop Integrity (maps to P7)
  audit→tasks→execute→PR never fails silently; commit comment + Telegram/Slack dual notify.
### E2 — Safety Surface (maps to P4/P7)
  Viktor authority, autoApprover gating, UI proxy allowlist, secret hygiene.
### E3 — Goal Enforcement (maps to P8)
  REPO_DIRECTIVE authoring + traces-to lint + autoApprover wiring.
### E4 — Self-Build Engine (maps to P9)
  Sentinel reads/writes its own + others' REPO_DIRECTIVE; dispatches traced tasks to sub-agents.
### E5 — Command Chain (maps to P9/P10)
  SHAYAN→HERMES→SENTINEL→agents enforced; no agent bypasses its level.

## Tasks

- [ ] T1 — Fix ARCHITECTURE.md stale `index.js`/`webhook.js` refs to `.ts` | traces-to: P7/S2/E1 | acceptance: grep finds no `.js` refs to src modules
- [ ] T2 — Resolve audit starvation: queued-threshold blocks new audits on 10–25 backlog | traces-to: P7/S2/E1 | acceptance: fresh audit runs when backlog stale
- [ ] T3 — Remove/repair dead `agents-ops-board` tracked repo | traces-to: P7/S2/E1 | acceptance: tracked list = only live repos
- [ ] T4 — Centralize 4 AI provider call patterns into ai/client.ts (6.3) or defer w/ note | traces-to: P6/S1 | acceptance: single client or D-005 deferral
- [ ] T5 — Consolidate duplicated UI utilities (6.5) | traces-to: P6/S1 | acceptance: no duplicate helper in ui/lib
- [ ] T6 — directive-lint (traces-to) in verify.sh + gate.yml | traces-to: P8/S3/E3 | acceptance: orphan task fails CI
- [ ] T7 — Sentinel drafts REPO_DIRECTIVE v1 for each portfolio repo | traces-to: P8/S3/E3 | acceptance: every repo has REPO_DIRECTIVE.md
- [ ] T8 — Wire autoApprover/priorityEngine to reject non-tracing tasks | traces-to: P8/S3/E3 | acceptance: orphan task never auto-executes
- [ ] T9 — Sentinel self-rewrite: regenerate its OWN REPO_DIRECTIVE from code/docs on a schedule | traces-to: P9/S4/E4 | acceptance: directive stays accurate vs code; diff reviewed by Hermes
- [ ] T10 — Self-build dispatch: Sentinel opens its OWN improvement PRs from traced tasks | traces-to: P9/S4/E4 | acceptance: Sentinel PR on branch, not main; Shayan approves
- [ ] T11 — Cross-repo builder: Sentinel spins sub-agents to build OTHER repos from their REPO_DIRECTIVE | traces-to: P9/S4/E4 | acceptance: sub-agent task traces to target repo directive; branch-only
- [ ] T12 — Enforce command chain: no sub-agent may modify REPO_RULES or push main | traces-to: P9/S4/E5 | acceptance: attempt blocked + logged to agent_authority_log

## Sentinel Constraints

- auto-approve: safe, tracing tasks in E1/E2/E3 with acceptance met; repo not locked.
- review-required: Viktor authority, UI proxy allowlist, auth, secret scanning, REPO_RULES edits.
- locked: `main` (never direct); `audits/private/`; any path Shayan marks via `lock <repo>`.
- budget: SPRINT_MONTHLY_BUDGET (default $30) gates batch size; >95% pauses auto-exec.
- chain: SHAYAN→HERMES→SENTINEL→agents. Sentinel may not approve its own merges; only Shayan does.
