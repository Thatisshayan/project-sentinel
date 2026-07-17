# Deferred Work Register

> Updated: 2026-07-17
> Agent: Codex
> Last audit: `audits/17.07.2026CodexPhase2Audit.md`

---

## Deferred Items

### D-001: ESLint TypeScript support
**Scope**: Linting disabled for all `.ts` files
**Reason blocked**: `@typescript-eslint/parser v8.x` is incompatible with TypeScript 7 (expects TS < 6.1.0). Locked by npm dependency chain.
**Impact**: No lint coverage for TypeScript files. JS files linted normally.
**Proposed resolution**: 
- Option A: Upgrade to `@typescript-eslint` v8.0+ when compatible with TS7 drops
- Option B: Use `--ext .ts` flag + disable `@typescript-eslint` rules (lint-only, no TS rules)
- Option C: Accept lint-only-JS for now, re-enable when ecosystem catches up
**Status**: Deferred — requires ecosystem update

### D-002: Phase 4 integration tests (testcontainers) — BLOCKED, no Docker
**Scope**: Phase 4 Tasks 4.1–4.4 integration tests that require Postgres/Redis via testcontainers
**Reason blocked**: This environment has **no Docker daemon** (`docker info` fails). testcontainers cannot start backing services, so DB/queue integration tests cannot run here.
**Impact**: Coverage must be raised via **unit tests with mocks** instead of integration tests. The 50%-line Phase 4 goal is therefore **not reachable in this environment**; unit-test-only coverage currently sits at ~33% lines.
**Proposed resolution**:
- Run the integration-test suite on a CI runner / machine with Docker available.
- Or stand up a local Postgres + Redis and point tests at them (set `DATABASE_URL` / `REDIS_URL` in test env).
**Status**: Deferred — blocked by missing Docker; track remaining coverage gap in Phase 4 TODO.

### D-003: Jest config is `jest.config.js`, not `jest.config.ts`
**Scope**: Phase 4 Task 4.0 infra artifact
**Reason blocked**: Jest 29's TypeScript config parser (`ts-node` + TS7) throws `Cannot read properties of undefined (reading 'fileExists')`. Same TS7-incompatibility root cause as D-001.
**Impact**: Config lives in `backend/jest.config.js` (CommonJS). Functionally identical; `@swc/jest` still transforms `.ts` tests.
**Status**: Deferred — acceptable workaround in place.

### D-004: Installing Docker on this agent box is NOT feasible
**Scope**: Enables D-002 (testcontainers integration tests for Phase 4)
**Reason blocked**: `docker` CLI is not present on this Win32 agent environment. Installing it requires Docker Desktop (admin rights, Hyper-V/WSL2 hypervisor enablement, and a host reboot) — infra changes outside an agent's authority and not automatable here.
**Impact**: Phase 4 integration tests (plan Tasks 4.1–4.4 real-DB path) remain blocked locally.
**Proposed resolution**:
- Run the integration suite on a CI runner or dev machine that already has Docker (recommended — keeps this agent box lean).
- Or provision Docker on a dedicated build host and point `DATABASE_URL` / `REDIS_URL` at it for the test run.
**Status**: Deferred — use a Docker-enabled runner; do not attempt to install Docker on this agent box.

---

## Completed Work (no action needed)

- ✅ TypeScript migration complete (Phase 1) — all .js → .ts
- ✅ AppError taxonomy implemented (Phase 2 Task 2.1)
- ✅ Global error handlers fixed with Sentry v8+ (Phase 2 Tasks 2.2, 2.4)
- ✅ Logger.error pattern fixed (Phase 2 Task 2.3) — 67 occurrences
- ✅ Structured error responses via Express middleware (Phase 2 Task 2.5)
- ✅ Phase 3 all tasks 3.1–3.6 completed (timing-safe auth, SSL CA, rate limit, action-proxy whitelist, child-env scoping, origin/CSRF guard) on `feat/phase3-security-hardening`
- ✅ Phase 4 Task 4.0 infra: `jest.config.js` with `coverageThreshold` gate + 4 new unit-test suites (errors, timingSafeCompare, childEnv, execAsync) — 150 tests passing, ~33% line coverage
- ✅ Phase 5 Tasks 5.1–5.3: `safeFire`/`fireAndForget` helper + tests; all ~100 silent `.catch(() => {})` swallows across 39 files converted to observable (log + Sentry) calls; BullMQ dead-letter queue wired in `queueClient.ts` + `index.ts`. 156 tests passing. (DLQ retry worker not runtime-verified — needs Redis/Docker, see D-002.)

---

## Notes for Future Agents

- Phase 2 error architecture is complete. The `AppError` class hierarchy in `src/errors/errors.ts` is the canonical error type. All new errors should subclass `AppError`.
- Lint for `.ts` files is temporarily disabled. Do not re-enable until `@typescript-eslint` releases a version compatible with TypeScript 7.
- The `.eslintrc.json` ignores `**/*.ts` via `ignorePatterns` (added 2026-07-17 to match this register). When lint for TS is re-enabled, remove `**/*.ts` from `ignorePatterns`.
- Phase 4 integration tests need Docker (D-002). Until then, raise coverage with mocked unit tests. The coverage gate in `jest.config.js` enforces no regression from the current baseline.
