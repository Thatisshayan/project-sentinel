# Sentinel — Master Task List

> **REBUILD IN PROGRESS — Phase 5/7 active.**
> Canonical plan: `docs/superpowers/plans/2026-07-16-sentinel-rebuild.md`
> Current status: `STATUS.md`
> Tasks are prefixed `[PhaseN]` to indicate which phase they belong to.

---

## 🛡️ Phase 0 — Foundation & Safety Net (COMPLETE)

| # | Task | Priority | Status |
|---|------|----------|--------|
| 0.1 | Overhaul CI to gate pull requests — add `pull_request` trigger | CRITICAL | ✅ Done |
| 0.2 | Add ESLint + Prettier to backend | HIGH | ✅ Done |
| 0.3 | Fix `execSync` → async `spawn` (event loop blocker) in taskBuilder, securityPatcher, dependencyScanner, index, repoOps | CRITICAL | ✅ Done |
| 0.4 | Setup Sentry error tracking (`@sentry/node`) | HIGH | ✅ Done |
| 0.5 | Security audit CI (npm audit, gitleaks, weekly OWASP) | MEDIUM | ✅ Done |
| 0.6 | Enforce branch protection on `main` (GitHub settings) | CRITICAL | ✅ Done |
| 0.7 | Clean up git-tracked stale + dangerous files | HIGH | ✅ Done |

---

## 🧩 Phase 1 — TypeScript Migration (COMPLETE)

| # | Task | Priority | Status |
|---|------|----------|--------|
| 1.0 | TypeScript build tooling (tsconfig, tsx, build scripts) | HIGH | ✅ Done |
| 1.1 | Convert infrastructure layer (logger, dbClient, config) | HIGH | ✅ Done |
| 1.2 | Convert data layer (all 8 `*Db.js` files) | HIGH | ✅ Done |
| 1.3 | Convert security cluster (5 files) | HIGH | ✅ Done |
| 1.4 | Convert agent cluster (8 files) | MEDIUM | ✅ Done |
| 1.5 | Convert telegram cluster (4 files) | MEDIUM | ✅ Done |
| 1.6 | Convert orchestration cluster (4 files) | HIGH | ✅ Done |
| 1.7 | Convert runner cluster (4 files) | HIGH | ✅ Done |
| 1.8 | Convert god modules (workers, webhook, api — 5 files) | HIGH | ✅ Done |
| 1.9 | Convert commands (4 files) | MEDIUM | ✅ Done |
| 1.10 | Convert entry point (index.js) | HIGH | ✅ Done |

---

## 🧱 Phase 2 — Error Architecture (COMPLETE)

| # | Task | Priority | Status |
|---|------|----------|--------|
| 2.1 | Define error classes (AppError, DbError, AICallError, etc.) | HIGH | ✅ Done |
| 2.2 | Fix global error handlers (unhandledRejection, Express handler) | HIGH | ✅ Done |
| 2.3 | Fix all incorrect logger.error patterns ({ err: err.message }) | MEDIUM | ✅ Done |
| 2.4 | Add config validation on boot (fail fast on missing critical env vars) | HIGH | ✅ Done |

---

## 🔒 Phase 3 — Security Hardening (IN PROGRESS — branch `feat/phase3-security-hardening`)

| # | Task | Priority | Status |
|---|------|----------|--------|
| 3.1 | Timing-safe auth comparisons (SENTINEL_UI_KEY, DEBUGGER_SHARED_SECRET) | CRITICAL | ✅ Done (commit `35d6e52`) |
| 3.2 | Fix SSL certificate validation (rejectUnauthorized: false → true) | CRITICAL | ✅ Done (commit `2a68f42`) |
| 3.3 | Add rate limiting to all API routes | HIGH | ✅ Done |
| 3.4 | Harden UI action proxy (path whitelist, CSRF, origin validation) | HIGH | ✅ Done — **correction 2026-07-19:** the original whitelist (commit `b0838cd`) was a literal-string `Set` that blocked several routes the UI itself calls (couldn't match dynamic `:id`/`:name` segments at all, and named some static routes wrong). Fixed 2026-07-19 (commit `db9fcd6`) with a regex allowlist verified against every `callAction()` call site in `ui/`. See P2-15. |
| 3.5 | Scope environment for child processes (don't spread entire process.env) | MEDIUM | ✅ Done |
| 3.6 | Add origin/CSRF check to all 5 UI proxy routes | MEDIUM | ✅ Done |
| 3.7 | Allowlist `dbClient.ts`'s `updateDebugAttempt` dynamic column names (SQL-injection-shaped footgun, flagged but not fixed in the original `ConfirmedBugs.md` scan) | MEDIUM | ✅ Done 2026-07-19 (PR #34, commit `8eefe60`) — explicit column allowlist added; non-allowlisted keys are dropped and logged as an error instead of reaching SQL. See `ConfirmedBugs.md` bug 29. |

---

## 🧪 Phase 4 — Test Coverage Blitz (IN PROGRESS)

> ⚠️ **D-002 (blocker):** No Docker daemon in this environment → testcontainers integration tests cannot run. Raise coverage via mocked unit tests. 50%-line goal not reachable here (currently ~33% lines unit-only). Integration suite must run on a Docker-enabled runner. See `docs/governance/DEFERRED_WORK.md`.

| # | Task | Priority | Status |
|---|------|----------|--------|
| 4.0 | Test infrastructure setup (jest.config.js + coverage thresholds; testcontainers **blocked D-002**, jest.config.ts **blocked D-003**) | HIGH | ✅ Done |
| 4.1 | Write tests for infrastructure layer (dbClient, queueClient, logger, config) — needs DB mocks; real-DB integration blocked D-002 | HIGH | ⏳ Pending |
| 4.2 | Write tests for security cluster (securityScanner, securityPatcher, owaspChecker, secretScanner, dependencyScanner) | CRITICAL | ⏳ Pending |
| 4.3 | Write tests for core pipeline (workers, sprintOrchestrator, sprintPlanner, taskBuilder, webhook) | CRITICAL | ⏳ Pending |
| 4.4 | Write tests for all remaining untested modules (29 files) | HIGH | ⏳ Pending |
| 4.5 | Add regression tests for already-fixed bugs | MEDIUM | ✅ Done 2026-07-19 — unit tests added for the bare-`setTimeout` fixes (`scheduledJobsWorker.test.ts`, covers autoApprover/correlationEngine/sprintOrchestrator/auditOrchestrator), `createNotionProject`/onboarding honesty (`repoOnboarder.onboardRepo.test.ts`), and the `telegramAI` complexity field-name bug (`telegramAI.createTask.test.ts`). Older bugs from the June JS-era scan and the rest of the July `ConfirmedBugs.md` pass 1 list do not have dedicated regression tests. |
| 4.6 | Set up UI test infrastructure (Vitest + React Testing Library) | MEDIUM | ⏳ Pending |

---

## 🧹 Phase 5 — Catch Pattern Elimination (IN PROGRESS)

| # | Task | Priority | Status |
|---|------|----------|--------|
| 5.1 | Create fire-and-forget helper (safeFire with Sentry + logging) | HIGH | ✅ Done (`src/utils/safeFire.ts` + tests) |
| 5.2 | Replace all ~100 `.catch(() => {})` silent-swallow patterns across 39 files | HIGH | ✅ Done (via @swc AST transform; tsc clean, 156 tests pass) |
| 5.3 | Add dead-letter queue for retryable fire-and-forget ops | MEDIUM | ✅ Done (BullMQ `dead-letter` queue + `index.ts` wiring; unverified — needs Redis/Docker D-002) |

> Note: 5.2 eliminated the *silent* swallows only. Pre-existing `.catch((err) => logger.error(...))` sites already observe errors and were left intact. DLQ retry worker (5.3) is wired but not runtime-exercised (no Redis in this env — D-002).

---

## 🏗️ Phase 6 — Architecture Refactoring (COMPLETE)

| # | Task | Priority | Status |
|---|------|----------|--------|
| 6.1 | Split workers.ts god module (596 LOC → src/workers/{buildPoll,dailyReport,sprint,agentCleanup}Worker.ts barrel) | HIGH | ✅ Done |
| 6.2 | Split webhook.ts (messages + processWebhook + processPREvent → src/webhook/) | HIGH | ✅ Done |
| 6.3 | Centralize 4 duplicated AI provider call patterns into one ai/client.ts | HIGH | ✅ Done 2026-08-04 — shared `stripThinkBlocks`, `extractJsonObject`, and `extractJsonArray` helpers added; migrated `ceoReport`, `sprintPlanner`, `sentinelBrain`, `telegramAI`, and `owaspChecker`. |
| 6.4 | Eliminate inline require() calls (replace with top-level imports) | MEDIUM | ✅ Done (12 files converted, tsc+jest verified) |
| 6.5 | Consolidate duplicated UI utilities (relativeTime, agentColor, mapBuild, etc.) | LOW | ✅ Done 2026-08-04 — shared helpers live in `ui/lib/format.ts` and `ui/lib/theme.ts`; no remaining inline duplicates found in `ui/app/` or `ui/components/`. |

---

## 🚀 Phase 7 — Operational Excellence

| # | Task | Priority | Status |
|---|------|----------|--------|
| 7.1 | DB migration tooling (replace CREATE TABLE IF NOT EXISTS with proper migrations) | HIGH | ✅ Done 2026-08-04 — added `backend/migrations/001-initial-schema.sql`, `backend/src/migrate.ts`, and wired `schema_migrations` tracking into `initSchema()`. |
| 7.2 | UI hardening (output:standalone, multi-stage Docker, error boundaries, loading states) | HIGH | ✅ Done 2026-08-04 — `ui/next.config.mjs` now uses `output: "standalone"`, `ui/Dockerfile` is multi-stage, and `ui/app/error.tsx` + `ui/app/loading.tsx` provide app-level fallbacks. |
| 7.3 | Monitoring setup (/metrics endpoint, slow-query alerting, self-review) | MEDIUM | ✅ Done 2026-08-04 — `/metrics` is live in `backend/src/index.ts`, `dbClient.ts` now alerts on slow queries over `DB_SLOW_QUERY_ALERT_MS` (default 500ms), and `dailyReportWorker.ts` schedules a weekly `self-review` job that runs `selfAuditor.ts`. |
| 7.4 | Documentation consolidation (archive 8 stale docs, merge MANUAL.md into README.md) | MEDIUM | ⏳ Pending |
| 7.5 | Set up Dependabot for auto dependency updates | MEDIUM | ⏳ Pending |
| 7.6 | Accessibility improvements (aria-labels, semantic HTML, color contrast, form labels) | LOW | ✅ Done 2026-08-04 — added semantic `aria-label`s to sidebar/nav/action buttons, labeled settings controls, and gave the security views table/list regions explicit roles. |
| 7.7 | Backend Dockerfile hardening (multi-stage, pinned digest, .dockerignore) | MEDIUM | ✅ Partially done 2026-08-04 — `.dockerignore` already existed; backend Dockerfile is still multi-stage and now works with the migration flow, but pinned digest work remains pending. |
| 7.8 | Railway config consistency (UI → Dockerfile, healthcheckPath, normalized casing) | LOW | ✅ Obsolete (2026-07-29) — hosting migrated off Railway to self-hosted Docker Compose on Oracle Cloud; see `docs/ORACLE_DEPLOY.md`. |
| 7.9 | Alert on stale `awaiting_approval`/`executing` audit cycles before their timeout fires (e.g. daily digest: "N pending, oldest is X days old") | MEDIUM | ✅ Done 2026-08-04 — `backend/src/dailyReport.ts` now includes a stale-cycle digest section using `STALE_AUDIT_CYCLE_ALERT_HOURS` (default 24h) and shows the oldest pending/executing cycle when any exist. |
| 7.10 | Add Slack as a second notification/command destination alongside Telegram | LOW | ✅ Done 2026-08-04 — outbound Slack fan-out already exists in `backend/src/telegramClient.ts`, inbound Events API + interactivity + command dispatch exist in `slackEvents.ts` / `slackInteractions.ts`, and the external-agent / roundtable Slack surface is wired in `agents/` + `commands/`. |
| 7.11 | Audit whether other Vercel projects in this account have the same "auto-deploys, nobody wired the env vars" gap as `project-sentinel` did | LOW | ⏳ Pending / blocked on external account access — needs an authenticated Vercel inventory pass before I can verify other projects. |
| 7.12 | Hardcoded `branchName: 'main'` in manual-audit routes (`/repo/:name/audit`, `/system/audit-all`) | MEDIUM | ✅ Done 2026-07-19 — replaced with `repoDiscovery.getDefaultBranch()`, a GitHub API lookup with a `'main'` fallback. Found live via a failed audit on `let-it-rain`. See `ConfirmedBugs.md` bug 31. |
| 7.13 | `agents-ops-board` in the tracked repo list points at a nonexistent GitHub repo — every audit fails with `Repository not found` | HIGH | ⏳ Pending — needs the user to say what this repo is actually called now / whether it should be removed. Confirmed failing since at least 2026-06-29 (3 cycles). See `ConfirmedBugs.md` bug 32. |
| 7.14 | Near-portfolio-wide `audit_tasks` backlog (10–25 queued per repo) is silently blocking Rule 2 across most tracked repos | HIGH | ✅ Done 2026-08-04 — `backend/src/dailyReport.ts` now emits a backlog digest for repos at/above `AUDIT_BACKLOG_ALERT_COUNT` (default 3 queued tasks), including the oldest queued timestamp. |

---

## 🔴 Existing P0 — Operational Issues (Blocked until Phase 0-1)

These are data-flow / configuration issues, not code bugs. They persist until the GitHub webhook pipeline is verified end to end. Tracked separately from the rebuild.

| # | Issue | Status |
|---|-------|--------|
| P0-2 | Health scores are all defaults (6.5/10) — webhooks not flowing | Pending |
| P0-3 | Zero build history across all repos | Pending |
| P0-4 | Tasks completed = 0 for all agents | Pending |

## 🟡 Existing P1 — Missing / Unverified

| # | Issue | Status |
|---|-------|--------|
| P1-8 | Brain deployed but not verified — never tested end to end | Pending |
| P1-9 | Railway service arrow visual not connected (cosmetic) | ✅ Obsolete (2026-07-29) — hosting migrated off Railway; see `docs/ORACLE_DEPLOY.md`. |
| P1-10 | DashScope international endpoint — verify working | Pending |

## 🟢 Existing P2 — Feature Gaps

| # | Issue | Status |
|---|-------|--------|
| P2-15 | ~~Three dashboard buttons call non-existent backend routes (bulk audit/scan/patch)~~ — **corrected & fixed 2026-07-19:** the backend routes exist and work; the real bug was `ui/app/api/action/route.ts`'s literal-string allowlist blocking them (and several other buttons: per-repo audit, per-agent toggle, security-issue patch, self-audit, pause-sprint). Fixed with a regex allowlist, commit `db9fcd6`. **Not verified in a running browser** — fix confirmed by static route-matching + `tsc`, not a live click-through. | Fixed (unverified live) |
