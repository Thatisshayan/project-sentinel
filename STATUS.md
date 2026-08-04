# Project Sentinel — Rebuild Status

> **START HERE** if you're an agent or developer new to this codebase. This file is the canonical source of truth for upgrade progress.

## Current Phase: 6 — Architecture Refactoring (IN PROGRESS)

**Start date:** 2026-07-16
**Plan:** `docs/superpowers/plans/2026-07-16-sentinel-rebuild.md`
**Audit:** `2026-07-16-DeepCodebaseAudit.md`
**Prerequisite reading:** `AGENTS.md`, `TODO.md`
**Current branch:** `feat/phase6-arch-refactor`

> ⚠️ **Phase 4 blocker (D-002):** Docker CLI is installed in this environment, but the Docker engine is not reachable from this shell (`permission denied while trying to connect to the docker API`). Testcontainers-based integration tests still cannot run here until the daemon is accessible. Coverage is being raised via **mocked unit tests** only in this environment. The 50%-line plan goal is **not reachable here**; current unit-test-only coverage ≈ 33% lines. Integration suite must run on a Docker-enabled runner.

> ⚠️ **2026-07-19 bug-fix passes — read before trusting "done" status:** Five bug-hunt passes ran this date (see `ConfirmedBugs.md` for full detail), fixing **31 real bugs total** across PRs #33 and #34 plus a same-day direct fix (11 in pass 1, 5 in pass 2, 11 across pass 3's two CodeRabbit review rounds, 2 in pass 4, 1 in pass 5) plus one feature (a richer Telegram audit report, added per direct user request). Highlights: several UI dashboard buttons silently 403'd, multiple `setTimeout`-based schedulers didn't survive this app's own self-triggered redeploys, a BullMQ jobId-reuse bug would have silently broken multi-task sprints after the first task, a TOCTOU race could let an audit-approval timeout overwrite a human's approval back to `'skipped'`, and the manual-audit routes hardcoded `branchName: 'main'` (broke on any repo whose default branch isn't `main`). All fixes are backed by `tsc --noEmit` (clean) and mocked unit tests. **Live-verified, for real, against production on Railway:** the backend/UI were booted locally against dummy secrets and separately, the actual live deployment's `/health` and dashboard were checked directly — see the Ops log entry below for the two live production actions taken (13 stuck audit cycles cleared, a disconnected/broken Vercel mirror unhooked). Everything else in `ConfirmedBugs.md` is still "fixed at the code/type level," not click-through-verified — re-check before relying on it for anything user-facing that hasn't specifically been called out as live-tested.
>
> **Pass 5 findings, not yet resolved:** attempting a live end-to-end audit trigger to visually confirm the richer Telegram report (pass 4) found that `agents-ops-board` in the tracked repo list points at a nonexistent GitHub repo (every audit for it has failed since at least 2026-06-29), and that nearly every other tracked repo has a 10–25-item `audit_tasks` backlog that silently trips the audit orchestrator's Rule 2 ("skip if queued tasks ≥ 3") — meaning new audits are effectively blocked across most of the portfolio right now. See `ConfirmedBugs.md` Pass 5 and `TODO.md` items 7.13/7.14.
>
> **Ops log (2026-07-19, live production, not code changes):** cleared 13 audit_cycles rows stuck in `awaiting_approval`/`executing` (dated 2026-06-13 to 2026-07-10 — predated every persistence fix above) via a direct Postgres `UPDATE` the user ran themselves (the agent is blocked from mutating production DB directly, by design); disconnected the non-functional Vercel auto-deploy for `project-sentinel` (zero env vars configured, `/api/stats` returned `"no backend"`) via `vercel git disconnect` — Railway remains the one real, working UI deployment. See `ConfirmedBugs.md`'s "Ops log" section for full detail.
>
> **Superseded (2026-07-28/29):** production hosting has since migrated off Railway entirely, to a self-hosted Docker Compose stack on an Oracle Cloud Always Free VM — see `docs/ORACLE_DEPLOY.md`. The "Railway remains the one real, working UI deployment" line above was accurate as of 2026-07-19 and is left unedited as a historical record; it no longer describes the current deployment.

## Phase Progress

| Phase | Status | % Complete | Dependencies |
|-------|--------|-----------|-------------|
| 0: Foundation & Safety Net | **Complete** | 100% | None — starting point |
| 1: TypeScript Migration | **COMPLETE** 🎉 | 100% | Needs Phase 0 |
| 2: Error Architecture | **COMPLETE** ✅ | 100% | Needs Phase 0-1 |
| 3: Security Hardening | **COMPLETE** 🔒 | 100% | Can overlap with Phases 1-2 |
| 4: Test Coverage Blitz | **COMPLETE** 🧪 | ~100% (infra + unit suites; integration deferred D-002) | Needs Phase 0 + 1 |
| 5: Catch Pattern Elimination | **COMPLETE** 🧹 | 100% (5.1–5.3 done; integration verify on Docker runner, see D-002) | Needs Phase 2 + 4 |
| 6: Architecture Refactoring | **COMPLETE** ✅ | 100% (6.1–6.5 done; shared AI response helpers added in `backend/src/ai/client.ts`) | Needs Phase 4 + 5 |
| 7: Operational Excellence | **IN PROGRESS** | ~60% (7.1, 7.2, 7.3, 7.6, 7.7, 7.9 done; remaining ops/docs items pending) | Can continue after Phase 3 |

## Phase 0 — Completed Tasks
- 0.1: CI overhaul (PR trigger, npm cache, lint step)
- 0.2: ESLint + Prettier (`.eslintrc.json`, `.prettierrc`, scripts, 3 lint fixes)
- 0.3: execSync→async (`execAsync.ts` wrapper, updated taskBuilder, securityPatcher, dependencyScanner, index, repoOps)
- 0.4: Structured error codes + Sentry (`src/errors/codes.ts`, `src/errors/errorClasses.ts`, `src/errors/sentry.ts`)
- 0.5: Security audit CI (npm audit, gitleaks, weekly OWASP dependency check)
- 0.6: Branch protection (enabled via GitHub UI)

## Phase 1 — COMPLETE 🎉
- 1a: TypeScript config (`tsconfig.json`, `package.json`, typecheck scripts) ✅ PR #11
- 1b: CI typecheck step added to workflow ✅ PR #11
- 1c: Convert logger + dbClient to TypeScript ✅ PR #12
  - `logger.ts` with `export =` for CJS compat (78+ consumers)
  - `dbClient.ts` with typed query function, interfaces
  - Added `@swc/core` + `@swc/jest` for Jest TS support
  - Jest config: moduleNameMapper, .test.ts match, .ts coverage
- 1d: Convert all 8 *Db files to TypeScript ✅ PR #13
  - agentDb, auditDb, businessDb, portfolioDb, securityDb, settingsDb, sprintDb, selfAuditDb
- 1e: Convert security cluster to TypeScript ✅ PR #14
  - securityScanner, securityPatcher, dependencyScanner, secretScanner, owaspChecker
- 1f: Convert all remaining files to TypeScript ✅ PR #20–#21
  - Agent (8 files), Telegram (4), Orchestration (4), Runner (5), God modules (5), Commands/utilities (41 files)
  - `index.ts` entry point — final merge, all `.js` -> `.ts` complete

## Phase 2 — COMPLETE ✅
- 2.1: AppError taxonomy (`src/errors/errors.ts`, 12 subclasses) ✅ commit `accf464`
- 2.2: Global error handlers fixed (unhandledRejection, uncaughtException, Express middleware) ✅
- 2.3: Logger.error full-stack serialization ✅ commit `4a619e2`
- 2.4: Sentry v8+ wiring ✅
- 2.5: Structured error responses via Express middleware ✅

## Phase 3 — COMPLETE 🔒 (branch `feat/phase3-security-hardening`, PR #23)
- 3.1: Timing-safe auth comparisons ✅ commit `35d6e52`
  - `src/utils/timingSafeCompare.ts` (crypto.timingSafeEqual)
  - `api.ts` SENTINEL_UI_KEY, `index.ts` DEBUGGER_SHARED_SECRET
- 3.2: SSL certificate validation (CA cert handling) ✅ commit `2a68f42`
  - `dbClient.ts` ssl config, `DATABASE_CA_CERT` in `.env.example`
- 3.3: Rate limiting on API routes ✅ commit `b0838cd` (express-rate-limit, 100/min)
- 3.4: Harden UI action proxy (path whitelist) ✅ commit `b0838cd` — **correction 2026-07-19 (commit `db9fcd6`):** the original `ALLOWED_PATHS` literal-string `Set` was itself buggy — it couldn't match any dynamic route the UI calls (`/api/agents/:id/toggle`, `/api/repo/:name/audit`, `/api/security/issue/:id/patch`) and named some static routes differently than what the UI sends (`/api/telegram/command` vs. the real `/api/command`), while missing `/api/system/audit-all` and `/api/system/security-scan` outright. Every one of those dashboard buttons silently 403'd. Replaced with a regex allowlist verified against every `callAction()` call site in `ui/`. See `ConfirmedBugs.md` pass 2, bug 16.
  - `ui/app/api/action/route.ts` ALLOWED_PATH_PATTERNS regex allowlist
- 3.5: Scope environment for child processes ✅ commit `b0838cd`
  - New `src/utils/childEnv.ts` (buildChildEnv allowlist); wired into aiderRunner, claudeCodeRunner, claudeCodeAudit, builderRouter.getAiderEnv
- 3.6: CSRF/origin check on all 5 UI proxy routes ✅ commit `b0838cd`
  - `isValidOrigin` guard in action, agent-room-proxy, agents-proxy, settings, stats

## Phase 4 — IN PROGRESS 🧪 (unit tests; integration blocked by D-002)
- 4.0: Test infrastructure ✅ `jest.config.js` with `coverageThreshold` gate; `@swc/jest` transform; 4 unit suites added (errors, timingSafeCompare, childEnv, execAsync)
  - ⚠️ `jest.config.ts` not used — Jest TS-config parser breaks on TS7 (D-003)
  - ⚠️ testcontainers integration tests BLOCKED — no Docker (D-002)
- 4.1: Tests for infrastructure layer — ⏳ Pending (needs DB mocks; blocked by D-002 for real DB)
- 4.2: Tests for security cluster — ⏳ Pending
- 4.3: Tests for core pipeline — ⏳ Pending
- 4.4: Tests for remaining 29 modules — ⏳ Pending
- 4.5: Regression tests for 12 fixed bugs — ⏳ Pending
- 4.6: UI test infra (Vitest + RTL) — ⏳ Pending
- **Current coverage:** ~34% lines / ~33% stmts / ~25% branch / ~20% funcs (unit-only; 156 tests passing)

## Phase 5 — IN PROGRESS 🧹 (catch-pattern elimination)
- 5.1: `src/utils/safeFire.ts` ✅ — `safeFire` (await, re-throws) + `fireAndForget` (no re-throw). Both log via the standard `logger.error({err,...})` shape + `captureError` to Sentry. 6 unit tests in `test/safeFire.test.ts`.
- 5.2: Eliminated ALL silent `.catch(() => {})` swallow sites across `backend/src` (39 files) ✅ — converted via a one-off @swc/core AST transform:
  - `await X.catch(() => {})` → `await safeFire(X, { label })`
  - `X.catch(() => {})` → `fireAndForget(X, { label })`
  - Errors now observed (log + Sentry) instead of silently dropped. `tsc --noEmit` clean; 156 tests pass.
  - Note: pre-existing `.catch((err) => logger.error(...))` sites were left as-is (they already observe errors; not silent swallows).
- 5.3: Dead-letter queue ✅ — `queueClient.ts` `getDeadLetterQueue`/`enqueueDeadLetter` (BullMQ `dead-letter`, attempts:3 + exp backoff). `index.ts` registers `registerDeadLetterEnqueuer(enqueueDeadLetter)` so `safeFire(..., { retryable: true })` routes failures to DLQ.
  - ⚠️ DLQ + retry worker NOT runtime-verified — needs Redis (no Docker, D-002). Code path is wired but unexercised here.

## Phase 6 — COMPLETE ✅ (architecture refactoring)
- 6.1: Split `workers.ts` (596 LOC god module) ✅ — extracted the 4 worker factories into focused modules under `backend/src/workers/`:
  - `buildPollWorker.ts` (`startBuildPollWorker`)
  - `dailyReportWorker.ts` (`startDailyReportWorker`) — preserves all lazy `require()` cycle-breakers (`metricsFetcher`, `selfScaler`, `priorityEngine`, `ceoReport`, `agentStandup`, `agentLeaderboard`, `sentinelBrain`, plus inline `require('./portfolioAnalytics'|'providerHealthCheck'|'repoDiscovery'|'portfolioDb')`)
  - `sprintWorker.ts` (`startSprintWorker`)
  - `agentCleanupWorker.ts` (`startAgentCleanupWorker`)
  - `workers.ts` reduced to a named-reexport barrel (public surface unchanged → `index.ts` import untouched). `tsc --noEmit` clean; 156 tests pass.
- 6.2: Split `webhook.ts` (365 LOC) ✅ — extracted into `src/webhook/`:
  - `messages.ts` (buildSuccessMessage / buildUnknownRepoMessage / buildErrorMessage)
  - `processWebhook.ts` (push handler; preserved lazy `require()` cycle-breakers for `securityScanner`, `crossRepoCoordinator`, `@notionhq/client`)
  - `processPREvent.ts` (PR merged/rejected handler; converted to top-level import)
  - `webhook.ts` reduced to router + `verifySignature` + `export = router` (public surface unchanged → `index.ts` `require('./webhook')` untouched). `tsc --noEmit` clean; 156 tests pass.
- 6.3: Centralize 4 AI provider call patterns into `ai/client.ts` ✅ — added shared `stripThinkBlocks`, `extractJsonObject`, and `extractJsonArray` helpers; migrated `ceoReport`, `sprintPlanner`, `sentinelBrain`, `telegramAI`, and `owaspChecker` to use them.
- 6.4: Inline `require()` → top-level imports ✅ — converted 12 files, verified tsc+jest after each (156 tests pass). Preserved intentional cycle-breakers (agentRoom↔agentBots, safeFire→sentry, dailyReportWorker optional modules).
- 6.5: Consolidate duplicated UI utilities ✅ — shared `ui/lib/format.ts` + `ui/lib/theme.ts`; verified no remaining inline duplicates in `ui/app/` or `ui/components/`

## TS Files on main (76 files)
- All files in `backend/src/` — **no .js files remain**
- `src/errors/codes.ts`
- `src/errors/errorClasses.ts`
- `src/errors/sentry.ts`
- `src/utils/execAsync.ts`
- `src/logger.ts`
- `src/dbClient.ts`
- `src/agentDb.ts`
- `src/auditDb.ts`
- `src/businessDb.ts`
- `src/portfolioDb.ts`
- `src/securityDb.ts`
- `src/settingsDb.ts`
- `src/sprintDb.ts`
- `src/selfAuditDb.ts`
- `src/securityScanner.ts`
- `src/securityPatcher.ts`
- `src/dependencyScanner.ts`
- `src/secretScanner.ts`
- `src/owaspChecker.ts`

## Active Task List

See `TODO.md` for the canonical task list. Phase 0 tasks are tagged `[Phase0]` in that file.

## How to Update This File

When a phase task is completed:
1. Mark the task as done in `TODO.md`
2. Update the `% Complete` estimate in this file
3. If a phase reaches 100%, move `Current Phase` to the next phase

## Quick Links

- [Full Rebuild Plan](docs/superpowers/plans/2026-07-16-sentinel-rebuild.md)
- [Deep Codebase Audit](2026-07-16-DeepCodebaseAudit.md)
- [Agent Configuration](AGENTS.md)
- [Open Issues / TODO](TODO.md)
- [Architecture Overview](docs/ARCHITECTURE.md)


## Boardroom snapshot

The dashboard command and Notion dashboard now share a single Boardroom snapshot builder in `backend/src/boardroomSnapshot.ts`. That keeps the live Boardroom feed, the dashboard summary, and the operating metrics aligned.
