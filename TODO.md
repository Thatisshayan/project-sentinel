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
| 3.4 | Harden UI action proxy (path whitelist, CSRF, origin validation) | HIGH | ✅ Done |
| 3.5 | Scope environment for child processes (don't spread entire process.env) | MEDIUM | ✅ Done |
| 3.6 | Add origin/CSRF check to all 5 UI proxy routes | MEDIUM | ✅ Done |

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
| 4.5 | Add regression tests for 12 already-fixed bugs | MEDIUM | ⏳ Pending |
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

## 🏗️ Phase 6 — Architecture Refactoring

| # | Task | Priority | Status |
|---|------|----------|--------|
| 6.1 | Split workers.ts god module (593 LOC, 25+ job types → separate job files) | HIGH | ⏳ Pending |
| 6.2 | Split webhook.ts (extract Notion sync, Telegram notify, security scan trigger) | HIGH | ⏳ Pending |
| 6.3 | Centralize 4 duplicated AI provider call patterns into one ai/client.ts | HIGH | ⏳ Pending |
| 6.4 | Eliminate inline require() calls (replace with top-level imports) | MEDIUM | ⏳ Pending |
| 6.5 | Consolidate duplicated UI utilities (relativeTime, agentColor, mapBuild, etc.) | LOW | ⏳ Pending |

---

## 🚀 Phase 7 — Operational Excellence

| # | Task | Priority | Status |
|---|------|----------|--------|
| 7.1 | DB migration tooling (replace CREATE TABLE IF NOT EXISTS with proper migrations) | HIGH | ⏳ Pending |
| 7.2 | UI hardening (output:standalone, multi-stage Docker, error boundaries, loading states) | HIGH | ⏳ Pending |
| 7.3 | Monitoring setup (/metrics endpoint, slow-query alerting, self-review) | MEDIUM | ⏳ Pending |
| 7.4 | Documentation consolidation (archive 8 stale docs, merge MANUAL.md into README.md) | MEDIUM | ⏳ Pending |
| 7.5 | Set up Dependabot for auto dependency updates | MEDIUM | ⏳ Pending |
| 7.6 | Accessibility improvements (aria-labels, semantic HTML, color contrast, form labels) | LOW | ⏳ Pending |
| 7.7 | Backend Dockerfile hardening (multi-stage, pinned digest, .dockerignore) | MEDIUM | ⏳ Pending |
| 7.8 | Railway config consistency (UI → Dockerfile, healthcheckPath, normalized casing) | LOW | ⏳ Pending |

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
| P1-9 | Railway service arrow visual not connected (cosmetic) | Pending |
| P1-10 | DashScope international endpoint — verify working | Pending |

## 🟢 Existing P2 — Feature Gaps

| # | Issue | Status |
|---|-------|--------|
| P2-15 | Three dashboard buttons call non-existent backend routes (bulk audit/scan/patch) | Pending |
