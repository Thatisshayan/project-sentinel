# Deferred Work Register

> Updated: 2026-07-25
> Agent: Hermes
> Last audit: `audits/2026-07-25_Hermes_PostAuditRemediation_Audit.md`

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
**Scope**: Enables D-002 (testcontainers integration tests for Phase4)
**Reason blocked**: `docker` CLI is not present on this Win32 agent environment. Installing it requires Docker Desktop (admin rights, Hyper-V/WSL2 hypervisor enablement, and a host reboot) — infra changes outside an agent's authority and not automatable here.
**Impact**: Phase4 integration tests (plan Tasks 4.1–4.4 real-DB path) remain blocked locally.
**Proposed resolution**:
- Run the integration suite on a CI runner or dev machine that already has Docker (recommended — keeps this agent box lean).
- Or provision Docker on a dedicated build host and point `DATABASE_URL` / `REDIS_URL` at it for the test run.
**Status**: Deferred — use a Docker-enabled runner; do not attempt to install Docker on this agent box.

### D-005: Phase6 Task 6.3 — centralize 4 AI provider call patterns into `ai/client.ts`
**Scope**: Phase6 Task 6.3 — the 4-provider OpenAI-compatible fallback chain (`NVIDIA NIM` → `Gemini` → `DashScope/Qwen` → `DeepSeek`, plus optional `Anthropic`) is hand-duplicated across `telegramAI.ts` (`callChatAPI`), `ceoReport.ts` (`callAI`), `sprintPlanner.ts`, `sentinelBrain.ts` (`callBrainAI`/`tryProvider`), `claudeCodeAudit.ts`, `owaspChecker.ts`, and `agentRoom.ts`.
**Reason deferred**: High refactor risk, low immediate payoff. Each caller has divergent defaults (different model names, `max_tokens`, `temperature`, `system` vs no-system prompt, `timeout` 30s vs 60s, and provider-specific quirks — e.g. `telegramAI` also falls back to Anthropic; `sentinelBrain`/`ceoReport` strip `<think>` blocks and parse JSON; `claudeCodeAudit` posts to a fixed NIM URL only). A naive shared helper risks breaking subtle behavior (reasoning-model output stripping, JSON extraction) that is load-bearing for the audit/brain code paths. Combined with 6.4 (inline `require()` cycle-breakers), converting these call sites to a shared module must be done with per-caller care, not a blind script, and is best sequenced after the architecture is otherwise settled.
**Impact**: Duplication remains in the provider-call layer; new providers must be added in N places.
**Proposed resolution**:
- Introduce `src/ai/client.ts` exporting `callAnyProvider({ systemPrompt?, userPrompt, maxTokens?, temperature?, timeoutMs?, modelOverride? })` that walks the standard provider precedence and returns content (with optional `<think>`/code-fence stripping).
- Refactor the cleanest callers first (`telegramAI.callChatAPI`, `ceoReport.callAI`, `sentinelBrain.callBrainAI`); defer `claudeCodeAudit`/`owaspChecker`/`agentRoom` (fixed-endpoint or different shape) until their contract is understood.
- Keep provider-specific post-processing (JSON parse, `<think>` strip) in the caller, not the shared client.
**Status**: Deferred — revisit after 6.4/6.5 or as a standalone focused PR.

### D-006: 19 moderate `npm audit` findings — transitive `@opentelemetry/core` via `@sentry/node`
**Scope**: `@sentry/node@8.55.2` (latest available on the 8.x line — we're already current within it) pulls in `@opentelemetry/core@1.30.1` and several `@opentelemetry/instrumentation-*` packages with a known moderate CVE (unbounded memory allocation parsing W3C Baggage propagation headers).
**Reason deferred**: The only available fix is a major-version jump to `@sentry/node@10.x` (v9 was skipped entirely on npm). `index.ts`'s Sentry init is explicitly written against the v8 API (see its "Sentry v8+ Express integration" comment), and this codebase cannot verify a real Sentry init locally — `safeFire.test.ts` documents that the real `@sentry/node` SDK hangs the Jest worker, so all Sentry-touching tests mock it out. Bumping two major versions blind, with no way to locally verify the init/capture path still works, risks silently breaking error monitoring in production — a worse outcome than the current moderate, transitive, `--audit-level=high`-non-blocking CVE.
**Impact**: `npm audit --production` reports 19 moderate findings; none are high/critical, so the CI gate (`--audit-level=high`) correctly stays green. No known exploit path from this codebase's usage (we don't parse untrusted W3C Baggage headers ourselves).
**Proposed resolution**: Bump to `@sentry/node@10.x` as a standalone, carefully-tested PR — ideally with a real Sentry DSN available in a staging environment to verify `captureError`/`captureException` still fire correctly, not just that `tsc`/mocked tests pass.
**Status**: Deferred — tracked, not blocking. Re-evaluate next time `@sentry/node` ships a security-relevant 8.x patch, or when staging Sentry verification is available.

### D-007: `timingSafeEqual` has a residual timing side-channel via early length-check
**Scope**: `utils/timingSafeCompare.ts` returned `false` immediately when `a.length !== b.length`, before ever reaching `crypto.timingSafeEqual`. This leaks the correct secret's length via response timing (early string-length comparison is fast; the constant-time compare is not reached at all).
**Status**: **Fixed** in Phase 8 (2026-07-18) — see below. Both inputs are now HMAC'd with a random-per-call key before comparison, so the compared buffers are always a fixed 32 bytes regardless of input length, and no length branch is needed. Moved out of "deferred" into "completed" below.

### D-008: 651 uses of `any` across 90/120 files in `backend/src`
**Scope**: Found in the 2026-07-25 code-level audit (`audits/2026-07-25_Hermes_PostAuditRemediation_Audit.md`). Heaviest concentration: `commands/repoOps.ts` (53), `api.ts` (45), `workers/dailyReportWorker.ts` (34), `agentRoom.ts` (21), `sentinelBrain.ts` (20), `notionClient.ts`/`telegramAI.ts` (19 each).
**Reason deferred**: Large, cross-cutting cleanup, not a bug — the TypeScript migration converted every file but a large share typed its way out rather than in. Fixing it well means threading real request/response shapes through the busiest orchestration and webhook code, which is exactly the code most likely to silently mishandle a malformed payload if done carelessly.
**Proposed resolution**: Tackle the 5 files above first (largest + busiest). Prefer per-file `noImplicitAny` tightening over a repo-wide flag flip, to keep each PR reviewable and testable independently.
**Status**: Deferred — open, not yet started.

### D-009: `execAsync` runs commands through a shell string, not an argv array
**Scope**: `backend/src/utils/execAsync.ts:32` wraps `child_process.exec` (shell-string), unlike the `spawn(cmd, args[])` calls used for `aider`/`claude` which sidestep shell parsing entirely.
**Reason deferred**: No live injection today — every current call site (`npm audit fix`, `npm audit --json`, `aider --version 2>&1`, `git --version 2>&1`) passes a fixed literal string. Fixing it requires an API change (`execAsync(cmd, args[])`) across 6 call sites (`securityPatcher.ts`, `taskBuilder.ts`, `commands/repoOps.ts`, `index.ts`, `dependencyScanner.ts`), not a one-line patch, and risks behavior changes in shell-feature-dependent calls (e.g. `2>&1` redirection in the `git --version`/`aider --version` health-check calls).
**Proposed resolution**: Migrate to `execFile`/`spawn` with an argv array; preserve the existing `scoped` (childEnv allowlist) behavior; handle stderr redirection explicitly in code instead of via shell `2>&1`.
**Status**: Deferred — open, footgun for future callers, not a present vulnerability.

### D-010: 9 open Dependabot PRs (#36–#44) all failing CI identically
**Scope**: `dependabot/npm_and_yarn/*` (3), `dependabot/docker/*` (2, including Node 20→26-alpine base image bumps for both `backend` and `ui`), `dependabot/github_actions/*` (4).
**Reason deferred**: Root-caused during the 2026-07-25 audit — not a bad dependency bump. Every branch predates the `retry.ts` → `utils/retry.ts` move already on `main`, so `telegramClient.ts` fails `tsc` (`Cannot find module './retry'`) on every one of them, identically, on both the `backend` and `ui` CI jobs.
**Action taken**: `@dependabot rebase` requested on all 9 PRs (2026-07-25) to pull in current `main` and get an accurate CI signal.
**Proposed resolution**: Once rebased, review each on its own merits. The two Docker base-image bumps (`#41` backend, `#37` ui — Node 20→26-alpine) deserve a real build/run pass before merge, not just green CI, since a Node major version can shift native-module ABI and base-image behavior.
**Status**: Deferred — rebase requested, awaiting fresh CI + Shayan's review/merge decision (R26 — Shayan approves, not an agent).

### D-011: root `.gitignore` does not cover Windows `desktop.ini` (REPO_RULES R19 gap)
**Scope**: R19 requires every repo to ship a `.gitignore` "covering secrets, `node_modules`, build output, and IDE files (`.vs`, `desktop.ini`)" from first commit. An untracked `desktop.ini` was observed locally during the 2026-07-25 audit session and left untouched — not this agent's file to add or remove without a dedicated pass.
**Proposed resolution**: Add `desktop.ini` (and confirm `.vs/` is covered) to the root `.gitignore` in a small `chore/` branch.
**Status**: Deferred — open, low risk, easy fix.

### D-012: `agent/hermes-governance-bootstrap`'s `be246e8` overwrote this register with an empty template
**Scope**: The `chore(governance): bootstrap repo governance (REPO_RULES v1.0.0)` commit (2026-07-23) on `agent/hermes-governance-bootstrap` replaced this file's full D-001–D-007 history + Completed Work log with an empty `## Items\n(none yet)` template — apparently the governance-bootstrap tooling writes a canned `DEFERRED_WORK.md` unconditionally without checking whether the repo already has one.
**Reason it mattered**: Flagged as "Finding G" in `audits/2026-07-25_Hermes_PostAuditRemediation_Audit.md` — merging that branch as-is would have silently destroyed this register, a direct R12/R33 violation.
**Resolution**: Reconciled by merging current `main` (post PR #46/#47) into `agent/hermes-governance-bootstrap` and resolving the conflict in favor of `main`'s full register — this D-012 entry itself is proof the merge preserved history rather than repeating the wipe.
**Proposed follow-up**: Whatever script/tool generated `be246e8`'s `DEFERRED_WORK.md` template should check for an existing file and append/preserve rather than overwrite, so this doesn't recur the next time governance bootstrap runs (e.g. on a new portfolio repo per REPO_DIRECTIVE P10).
**Status**: Resolved (2026-07-25) — this file is intact; follow-up (fixing the bootstrap tooling itself) remains open.

---

## Completed Work (no action needed)

- ✅ TypeScript migration complete (Phase 1) — all .js → .ts
- ✅ AppError taxonomy implemented (Phase 2 Task 2.1)
- ✅ Global error handlers fixed with Sentry v8+ (Phase 2 Tasks 2.2, 2.4)
- ✅ Logger.error pattern fixed (Phase 2 Task 2.3) — 67 occurrences
- ✅ Structured error responses via Express middleware (Phase 2 Task 2.5)
- ✅ Phase 3 all tasks 3.1–3.6 completed (timing-safe auth, SSL CA, rate limit, action-proxy whitelist, child-env scoping, origin/CSRF guard) on `feat/phase3-security-hardening`
- ✅ Phase 4 Task 4.0 infra: `jest.config.js` with `coverageThreshold` gate + 4 new unit-test suites (errors, timingSafeCompare, childEnv, execAsync) — 150 tests passing, ~33% line coverage. **Correction (2026-07-18 audit)**: this gate is not actually enforced anywhere — `.github/workflows/ci.yml` runs `npm run test` (`jest --runInBand --forceExit`), which does not pass `--coverage`, so `coverageThreshold` is never evaluated in CI. Running `npm run test:coverage` directly shows the repo is currently **below its own configured threshold** (30.03% statements vs 31% required, 31.47% lines vs 32% required) — largely because the Phase 6.1 `workers/` split (`buildPollWorker.ts`, `dailyReportWorker.ts`, `sprintWorker.ts`, `agentCleanupWorker.ts`) has 0% coverage. Either wire `test:coverage` (or `--coverage`) into CI so the gate is real, or lower the documented threshold to match reality — currently it's neither enforced nor met.
- ✅ Phase 5 Tasks 5.1–5.3: `safeFire`/`fireAndForget` helper + tests; ~100 silent `.catch(() => {})` swallows across 39 files converted to observable (log + Sentry) calls. **Correction (2026-07-18 audit)**: the original note here claimed the BullMQ dead-letter queue was "wired in `queueClient.ts` + `index.ts`" — it was not; `registerDeadLetterEnqueuer` was never called anywhere and `queueClient.ts` had no DLQ implementation, so every `retryable: true` safeFire call silently no-opped its retry path. Fixed in the `fix/phase7-audit-followups` branch: `queueClient.ts` now exports a real `enqueueDeadLetter` (BullMQ queue, attempts:3, exponential backoff), `index.ts` calls `registerDeadLetterEnqueuer(enqueueDeadLetter)` at startup, and the handful of call sites that write durable state (`updateNotionTaskStatus`, `upsertTaskROI`, `insertSecurityIssue`, `updateSecurityScan`, `markAgentError`) now pass `retryable: true`. Covered by `test/queueClient.test.ts`. DLQ retry worker (a consumer that drains the queue) is still not built — see D-002 for the Redis/Docker constraint blocking that.
- Residual gaps found in the same audit, not yet fixed: several bare `catch {}` blocks still swallow errors silently in `webhook/processWebhook.ts`, `telegramCommands.ts`, `commands/repoOps.ts`, `agentRoom.ts` (require()-load-failure and optional-UI-render paths); `utils/execAsync.ts` spreads the full `process.env` by default into `npm ci`/`npm install`/`pip install`/`npm audit fix` run against externally-controlled repo manifests, which is a supply-chain-relevant gap the childEnv scoping work did not cover.
- ✅ Phase 7 (PR #27): all of the above residual gaps fixed for real — 9 bare `catch {}` blocks now log via `logger.warn`; `execAsync.ts` got an opt-in `scoped` param (childEnv allowlist) applied to the 5 call sites that run installs against untrusted repos; the fake dead-letter queue was replaced with a real BullMQ-backed one and proven end-to-end in `test/queueClient.test.ts`; the `workers/` split (0% coverage despite "156 tests passing") got 5 new test files / 32 cases; `ci.yml` now runs `test:coverage` so the threshold gate is actually enforced. Verified: 191/191 tests, `test:coverage` exits 0.
- ✅ Phase 8 (2026-07-18, this audit's remediation pass): `monthlySecurityReport.ts` was a stub (`// TODO: implement`) silently firing on the real monthly cron — replaced with a real report built from `securityDb`'s portfolio summary + new/resolved issue counts, covered by `test/monthlySecurityReport.test.ts`. `backend/.env.example` was missing ~55 of the 92 env vars actually read by the code (including `GITHUB_TOKEN`, `SENTRY_DSN`, every LLM provider key, all 8 `BOT_TOKEN_*` agent identities, and ~40 tuning knobs) — brought to 100% parity. `AGENTS.md`'s status header was still reporting "Phase 6/7 active" after both had shipped — updated. `timingSafeEqual`'s length-check timing leak (D-007) — fixed via HMAC-then-compare so the compared buffers are always a fixed 32 bytes regardless of input length. `@sentry/node`'s transitive OpenTelemetry CVEs (D-006) — evaluated and deliberately deferred (see D-006) rather than blind-bumping a 2-major-version jump with no way to locally verify Sentry still works. Verified: 197/197 tests, `tsc` clean, `test:coverage` exits 0.

---

## Notes for Future Agents

- Phase 2 error architecture is complete. The `AppError` class hierarchy in `src/errors/errors.ts` is the canonical error type. All new errors should subclass `AppError`.
- Lint for `.ts` files is temporarily disabled. Do not re-enable until `@typescript-eslint` releases a version compatible with TypeScript 7.
- The `.eslintrc.json` ignores `**/*.ts` via `ignorePatterns` (added 2026-07-17 to match this register). When lint for TS is re-enabled, remove `**/*.ts` from `ignorePatterns`.
- Phase 4 integration tests need Docker (D-002). Until then, raise coverage with mocked unit tests. The coverage gate in `jest.config.js` enforces no regression from the current baseline.
