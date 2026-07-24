# project-sentinel — REPO_DIRECTIVE

> This file is the GOAL-layer constitution for this repo. `REPO_RULES.md` is the
> law (how to work). This file is the mission (what to build, and what NOT to).
> Every task in `docs/`, `TODO.md`, PRs, and Sentinel-generated work MUST carry a
> `traces-to:` pointer to a Phase/Sprint/Epic below. Orphan tasks are rejected by
> CI (scripts/verify.sh → directive-lint) and by Sentinel's autoApprover.

## Vision

Project Sentinel is an autonomous DevOps operating system for a solo founder: it
watches a portfolio of GitHub repos and runs a closed loop — detect change → audit
→ generate improvement tasks → execute safe tasks via AI coding agents → open PRs →
track merge → report — through Telegram and Slack, dispatching to both internal
AI-model agents and external Slack-native agents. Its north-star is automatically
maintained ground truth (Notion) on every code change / build outcome, with zero
forgotten broken commits.

## Non-Goals

- NOT a general-purpose chatbot. Commands are verb-first, scoped to repo/devops ops.
- NOT replacing CodeRabbit. CodeRabbit is the PRIMARY audit engine; Sentinel's own
  audit is fallback-only (CODERABBIT_FALLBACK_DELAY_MIN).
- NOT executing unsafe/unreviewed tasks automatically. Builder is gated by
  autoApprover + Viktor authority allow-list (all disabled by default).
- NOT spending paid API/infra beyond SPRINT_MONTHLY_BUDGET without Shayan approval.
- NOT deleting files or pushing to `main` — ever (REPO_RULES Rule 14 / branch-only).
- NOT adopting Anthropic as default provider; it is last-resort only.
- NOT building a separate UI auth system; the UI is a server-proxied read surface
  behind SENTINEL_UI_KEY + origin/CSRF guards.

## Phases

### P1 — Foundation & Safety Net (COMPLETE)
  exit criteria: CI (PR trigger, lint, typecheck, security-audit steps) green;
  ESLint/Prettier; execSync→async; structured errors + Sentry; branch protection on.

### P2 — TypeScript Migration (COMPLETE)
  exit criteria: zero `.js` in backend/src; `tsc --noEmit` clean; Jest TS transform.

### P3 — Error Architecture (COMPLETE)
  exit criteria: AppError taxonomy + global handlers + Sentry v8 wired; no unhandled
  rejections in prod paths.

### P4 — Security Hardening (COMPLETE)
  exit criteria: timing-safe compare; DB CA cert; rate-limit 100/min; scoped child
  env; UI proxy path-allowlist (regex, verified vs every call site); origin/CSRF.

### P5 — Test Coverage Blitz (COMPLETE — unit only)
  exit criteria: jest coverageThreshold gate; 156 unit tests passing; safeFire +
  fireAndForget + DLQ. INTEGRATION deferred (D-002, no Docker).

### P6 — Architecture Refactoring (IN PROGRESS ~50%)
  exit criteria: god modules split (workers.ts, webhook.ts done); inline require→
  top-level imports done; 6.3 (centralize AI client) DONE or explicitly deferred;
  6.5 (UI util consolidation) done. No public-surface regressions (tsc + 156 tests).

### P7 — Operational Excellence (PENDING)
  exit criteria: integration suite green on Docker runner; DLQ/retry runtime-verified;
  live-verified audit loop (no silent failures); doc-drift eliminated
  (ARCHITECTURE.md `index.js`→`index.ts`); 50% line coverage reached.

### P8 — Goal-Layer Enforcement (THIS DIRECTIVE's phase)
  exit criteria: REPO_DIRECTIVE.md present + linted in every portfolio repo; Sentinel
  drafts v1 per repo; autoApprover rejects non-tracing tasks; priorityEngine consumes
  directive as goal input.

## Sprints

### S1 (maps to P6) — finish arch refactor
  goal: close 6.3 + 6.5 without public-surface breakage.

### S2 (maps to P7) — operational truth
  goal: kill silent failures; reach integration coverage; fix doc drift.

### S3 (maps to P8) — directive rollout
  goal: every repo has a linted REPO_DIRECTIVE; Sentinel enforces tracing.

## Epics / Chapters

### E1 — Core Loop Integrity (maps to P7)
  audit → tasks → execute → PR must never fail silently; GitHub commit comment +
  Telegram/Slack dual notification is the contract.

### E2 — Safety Surface (maps to P4/P7)
  Viktor authority, autoApprover gating, UI proxy allowlist, secret hygiene.

### E3 — Goal Enforcement (maps to P8)
  REPO_DIRECTIVE authoring + traces-to lint + Sentinel autoApprover wiring.

## Tasks

- [ ] T1 — Fix ARCHITECTURE.md stale `index.js`/`webhook.js` references to `.ts` | traces-to: P7/S2/E1 | acceptance: grep finds no `.js` refs to src modules
- [ ] T2 — Resolve audit starvation: queued-threshold (MIN_QUEUED_BEFORE_SKIP_AUDIT) trips on 10–25 backlog, blocking new audits portfolio-wide | traces-to: P7/S2/E1 | acceptance: fresh audit runs when backlog present but stale
- [ ] T3 — Remove/repair dead `agents-ops-board` tracked repo (nonexistent GitHub repo) | traces-to: P7/S2/E1 | acceptance: tracked-repo list contains only live repos
- [ ] T4 — Centralize 4 AI provider call patterns into ai/client.ts (6.3) or defer w/ note | traces-to: P6/S1 | acceptance: single client module or documented D-005 deferral
- [ ] T5 — Consolidate duplicated UI utilities (6.5) | traces-to: P6/S1 | acceptance: no duplicate helper across ui/lib
- [ ] T6 — Add directive-lint (traces-to) to scripts/verify.sh + gate.yml | traces-to: P8/S3/E3 | acceptance: orphan task fails CI
- [ ] T7 — Sentinel drafts REPO_DIRECTIVE v1 for each portfolio repo | traces-to: P8/S3/E3 | acceptance: every repo has REPO_DIRECTIVE.md
- [ ] T8 — Wire autoApprover/priorityEngine to reject non-tracing tasks | traces-to: P8/S3/E3 | acceptance: orphan task never auto-executes

## Sentinel Constraints

- auto-approve: safe, tracing tasks in E1/E2 with acceptance criteria met and
  repo not locked.
- review-required: anything touching Viktor authority, UI proxy allowlist, auth,
  or secrets scanning.
- locked: `main` (never direct), any file under `audits/private/`, and any path
  Shayan marks via `lock <repo>`.
- budget: SPRINT_MONTHLY_BUDGET (default $30) gates batch size; >95% pauses auto-exec.
