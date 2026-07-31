# Deferred Work Register

> Updated: 2026-07-31 (D-008 closed)
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
**Done (2026-07-29)**: `src/ai/client.ts` (new) exports `callAnyProvider({ userPrompt, systemPrompt?, maxTokens?, temperature?, timeoutMs?, models?, includeAnthropic? })`. It walks the standard free-tier-first precedence (NVIDIA → Gemini → DashScope → DeepSeek → opt-in Anthropic), trying each configured provider in turn until one succeeds — the same fallback-on-failure loop `sentinelBrain.ts` already used in production, now applied uniformly. `telegramAI.callChatAPI`, `ceoReport.callAI`, `sentinelBrain.callBrainAI`, and `sprintPlanner.callFreeAI` (the 4 cleanest/most-similar callers) were refactored onto it; each still owns its own post-processing (`<think>`-block stripping, JSON parsing) in the caller, not the shared client, per the original proposal.
**Intentional behavior harmonization** (not just dedup): previously only `sentinelBrain` retried the next provider on a request failure — `telegramAI`/`ceoReport`/`sprintPlanner` only ever tried the first *configured* provider and gave up entirely if that one call failed. All 4 callers now get the more resilient try-all-until-success behavior. Similarly, `temperature` previously was only applied to the NVIDIA branch in 3 of the 4 files (copy-paste artifact) — it's now applied uniformly to whichever provider ends up handling the request, matching each caller's originally-intended value (0.3 telegramAI, 0.4 ceoReport, 0.1 sprintPlanner, 0.2 sentinelBrain — via a `models` per-provider override map, since e.g. `sentinelBrain` deliberately used `gemini-2.5-pro` instead of the shared default `gemini-2.0-flash`).
**Done (2026-07-31), remaining 3 call sites**: `claudeCodeAudit.ts` (`runNvidiaAudit` → `runProviderAudit`), `owaspChecker.ts` (`callNvidiaForSecurity` → `callProviderForSecurity`), and `agentRoom.ts` (`generatePersonalityMessage`'s inline `https.request` NVIDIA call) all now go through `callAnyProvider`. Each was single-provider (NVIDIA-only, hand-rolled `axios`/`https` calls) and is now on the same free-tier-first fallback chain as the other 4 callers — a real resilience gain, not just dedup, since e.g. the audit path previously had zero fallback if NVIDIA_NIM had an outage but Gemini/DashScope/DeepSeek were configured. Each caller's own NVIDIA model override (`AUDIT_MODEL`, `OWASP_MODEL`, `CHAT_MODEL`) is preserved via `models: { nvidia: ... }` so behavior is unchanged when only `NVIDIA_API_KEY` is set. The entry gates (`if (process.env['NVIDIA_API_KEY'])` / `if (!personality || !process.env['NVIDIA_API_KEY'])`) were broadened to check any of the 4 provider keys, matching the harmonized behavior of the other 4 callers.
**Verified**: 544/544 backend tests pass (including `test/ai.client.test.ts` covering the fallback loop, model overrides, and configured/unconfigured error paths), `tsc --noEmit` clean.
**Status**: **Complete.** All 7/7 original call sites now share `ai/client.ts`'s `callAnyProvider`.

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
**2026-07-29 survey of the 5 worst files**: the `any` usage splits into 3 buckets with very different value: (1) `catch (err: any)` — the bulk of the count in `repoOps.ts`/`dailyReportWorker.ts`/`agentRoom.ts`, idiomatic and low-value to touch; (2) Express handler signatures in `api.ts` — `(req: any, res: any)` on ~24 routes, the best ROI, purely mechanical; (3) DB row shapes (`rows.map((r: any) => ...)`) — root cause is upstream, e.g. `agentDb.ts`'s `getAllAgents()` itself returned `Promise<any[]>`, so every caller inherited `any` rather than a real row type.
**Done (2026-07-29), first slice**: 
- `api.ts` — all ~24 route handlers typed `(req: Request, res: Response[, next: NextFunction])` from `express`, replacing `any`. Surfaced and fixed real (previously silent) gaps: `req.params`/`req.query` index-signature access needed `noPropertyAccessFromIndexSignature`-compliant bracket notation, and 4 call sites needed an explicit `typeof x !== 'string'` guard where a route/query param could theoretically be an array or undefined and was being passed straight into a regex `.test()`/`repoFullName()`/`parseInt()` without a type check.
- New `backend/src/types/agentRow.ts` — real `AgentRow`/`AgentMessageRow` interfaces for the `agent_registry`/`agent_messages` tables (kept in a standalone module since `agentDb.ts` uses `export =`, which TS disallows mixing with other `export` statements). `agentDb.ts`'s `getActiveAgents`/`getIdleAgents`/`getAllAgents`/`getRecentMessages`/`releaseExpiredLocks` now return real types instead of `any[]`. Threaded through every caller: `agentRoom.ts`, `commands/repoOps.ts`, `conflictDetector.ts`, `agentStandup.ts`.
- **Real bug caught by the tightening**: `agentStandup.ts` read `agent.emoji` — a property that never existed on `agent_registry` rows — so the per-agent emoji in standup fallback messages always silently rendered the generic 🤖 regardless of which agent was speaking. `agentRoom.ts` already has a real `AGENT_EMOJI` lookup-by-`agent_id` map (used correctly elsewhere, e.g. `agentBots.ts`) — `agentStandup.ts` now uses that instead, restoring per-agent emoji in the fallback path.
- Verified: 544/544 backend tests pass, `tsc --noEmit` clean.
**Done (2026-07-30/31), remaining slices — CLOSED**: Worked through every remaining file across ~20 commits, one cluster at a time (debug-orchestration, business/reporting, Slack, BullMQ workers, webhook payloads, agent/audit-db, and a final small-file batch), each verified with `tsc --noEmit` + the full 544-test suite before committing. Added ~25 new files under `backend/src/types/` (row shapes for `debug_attempts`, `self_audit_cycles`/`model_performance`/`component_health`, `audit_cycles`, `conversation_history`, queue-job payloads, Slack events, etc.) following the established pattern: standalone modules for anything whose source file uses `export =`, since that syntax disallows mixing with other named exports.
Caught several real (previously silent) bugs while tightening types, each fixed in the same commit: `corr.pr_count` (a Postgres `COUNT(*)`) is the *string* `"0"` for zero rows, not the number `0` — the old `!corr.pr_count` truthiness check could never catch that case in two call sites; a lowest-health-repo reducer compared `health_score` as raw strings ("9" < "10" is false lexically); `webhook/processWebhook.ts`'s `enqueueBuildCheck` call passed a raw Notion string `topicId` through unparsed while the sibling `orchestrateDebug` call two lines up already did `parseInt`; `portfolioDb.ts`'s `upsertRepoMetrics` declared `lastBuildAt` as `string | null` but `lastCommitAt` (fed from the same source) as `string | Date | null`; a Slack `conflict:reassign` handler read a `conflict.lockedBy` field that never existed on the pending-conflict record.
**Remaining, deliberately not touched**: `dbClient.ts`'s `query<T extends QueryResultRow = any>()` generic default — the DB helper's fallback for the many call sites that don't pass an explicit row type. This is a single, intentional default at the system boundary, not an overlooked case; changing it means touching every untyped `query()` call site repo-wide, out of scope for a mechanical any-cleanup pass.
**Status**: **Complete.** A full `backend/src` sweep (`rg ':\s*any\b|<any>|as any\b|any\[\]|Record<string,\s*any>'` excluding lines containing `catch`) shows zero non-catch `any` remaining outside the one documented exception above. `catch (err: any)` blocks and `.catch((err: any) => ...)` callbacks were left as-is throughout — idiomatic, low-value, and explicitly out of scope per the 2026-07-29 survey.

### D-009: `execAsync` runs commands through a shell string, not an argv array
**Scope**: `backend/src/utils/execAsync.ts:32` wraps `child_process.exec` (shell-string), unlike the `spawn(cmd, args[])` calls used for `aider`/`claude` which sidestep shell parsing entirely.
**Reason deferred**: No live injection today — every current call site (`npm audit fix`, `npm audit --json`, `aider --version 2>&1`, `git --version 2>&1`) passes a fixed literal string. Fixing it requires an API change (`execAsync(cmd, args[])`) across 6 call sites (`securityPatcher.ts`, `taskBuilder.ts`, `commands/repoOps.ts`, `index.ts`, `dependencyScanner.ts`), not a one-line patch, and risks behavior changes in shell-feature-dependent calls (e.g. `2>&1` redirection in the `git --version`/`aider --version` health-check calls).
**Proposed resolution**: Migrate to `execFile`/`spawn` with an argv array; preserve the existing `scoped` (childEnv allowlist) behavior; handle stderr redirection explicitly in code instead of via shell `2>&1`.
**Status**: Deferred — open, footgun for future callers, not a present vulnerability.

### D-010: 9 open Dependabot PRs (#36–#44) all failing CI identically
**Scope**: `dependabot/npm_and_yarn/*` (3), `dependabot/docker/*` (2, including Node 20→26-alpine base image bumps for both `backend` and `ui`), `dependabot/github_actions/*` (4).
**Reason deferred**: Root-caused during the 2026-07-25 audit — not a bad dependency bump. Every branch predates the `retry.ts` → `utils/retry.ts` move already on `main`, so `telegramClient.ts` fails `tsc` (`Cannot find module './retry'`) on every one of them, identically, on both the `backend` and `ui` CI jobs.
**Action taken**: `@dependabot rebase` requested on all 9 PRs (2026-07-25) to pull in current `main` and get an accurate CI signal. Once rebased, all 9 showed green `backend`/`ui` CI. With Shayan's explicit approval, merged 6 of the 7 low-risk bumps (#36 gitleaks-action, #38 actions/checkout, #40 actions/upload-artifact, #42 backend prod deps, #43 ui prod deps, #44 backend dev deps). #39 (actions/setup-node) developed a real merge conflict from #38 landing first (both touch `.github/workflows/ci.yml`) — `@dependabot rebase` requested again on #39.
**Proposed resolution**: `#37`/`#41` (Node 20→26-alpine Docker base-image bumps, backend + ui) intentionally left open per Shayan's decision — a runtime major-version jump deserves a real build/run pass before merge, not just green CI, since it can shift native-module ABI and base-image behavior.
**#37 (ui) resolved (2026-07-25)**: Reviewed and merged. `ui/railway.toml` uses `builder = "NIXPACKS"`, which ignores `ui/Dockerfile` entirely for the actual Railway production build — this change only affects local `docker-compose up`. Confirmed `node:26-alpine` is a real published tag; `ui`'s dependency tree is pure JS/React with no native-compiled packages.
**#41 (backend) — confirmed broken, NOT merged (2026-07-25)**: Since `backend/railway.toml` uses `builder = "dockerfile"` (this Dockerfile is what Railway actually deploys), added a real `docker-build` CI job (see PR #50) rather than trusting green CI on a check that never builds the image. Ran it for real against this PR's `node:26-alpine` branch: **it fails**. `node:26-alpine`'s Alpine base ships Python 3.14; the Dockerfile's `pip3 install aider-install --break-system-packages` step needs to build a package from source under Python 3.14 (no prebuilt wheel yet) and fails with `pip._vendor.pyproject_hooks._impl.BackendUnavailable: Cannot import 'setuptools.build_meta'`. Merging as-is would have broken the production build — the same class of incident as the prior TS-migration crash-loop fix. Documented on the PR (comment) with three options: wait for `aider-install`'s build deps to support Python 3.14, pin an explicit Python version in the Dockerfile instead of inheriting whatever the base image ships, or add an explicit `setuptools` upgrade before the aider-install step.
**Status**: Resolved for #36/#38/#40/#42/#43/#44 (merged) and #37 (merged, confirmed low-risk). #39 merged after a second rebase. **#41 open and blocked** — confirmed broken by a real build, not just deferred out of caution; needs a Dockerfile fix before it can merge.

### D-011: root `.gitignore` does not cover Windows `desktop.ini` (REPO_RULES R19 gap)
**Scope**: R19 requires every repo to ship a `.gitignore` "covering secrets, `node_modules`, build output, and IDE files (`.vs`, `desktop.ini`)" from first commit. An untracked `desktop.ini` was observed locally during the 2026-07-25 audit session and left untouched — not this agent's file to add or remove without a dedicated pass.
**Proposed resolution**: Add `desktop.ini` (and confirm `.vs/` is covered) to the root `.gitignore` in a small `chore/` branch.
**Status**: Deferred — open, low risk, easy fix.

### D-012: `agent/hermes-governance-bootstrap`'s `be246e8` overwrote this register with an empty template
**Scope**: The `chore(governance): bootstrap repo governance (REPO_RULES v1.0.0)` commit (2026-07-23) on `agent/hermes-governance-bootstrap` replaced this file's full D-001–D-007 history + Completed Work log with an empty `## Items\n(none yet)` template — apparently the governance-bootstrap tooling writes a canned `DEFERRED_WORK.md` unconditionally without checking whether the repo already has one.
**Reason it mattered**: Flagged as "Finding G" in `audits/2026-07-25_Hermes_PostAuditRemediation_Audit.md` — merging that branch as-is would have silently destroyed this register, a direct R12/R33 violation.
**Resolution**: Reconciled by merging current `main` (post PR #46/#47) into `agent/hermes-governance-bootstrap` and resolving the conflict in favor of `main`'s full register — this D-012 entry itself is proof the merge preserved history rather than repeating the wipe.
**Proposed follow-up**: Whatever script/tool generated `be246e8`'s `DEFERRED_WORK.md` template should check for an existing file and append/preserve rather than overwrite, so this doesn't recur the next time governance bootstrap runs (e.g. on a new portfolio repo per REPO_DIRECTIVE P10).
**Follow-up fixed (2026-07-25)**: Root cause traced to `D:\AgentDevWork\_governance_build\apply_repo_governance.sh` / `.ps1` — both unconditionally `cp`/`Copy-Item -Force`'d the template's empty `docs/governance/DEFERRED_WORK.md` and `docs/README.md` over the target repo's copies, contradicting the script's own "idempotent; does not clobber existing user files" comment. Fixed both scripts to only seed those two files when the target doesn't already have one (`REPO_RULES.md`/`AGENTS.md`/`verify.sh`/`verify.ps1`/`gate.yml`/`BRANCH_POLICY.md` are still force-copied every run, since those are meant to stay in sync with the shared template — only the two files that accumulate real repo-specific state were changed). Also backported this repo's PR #45 fix for `docs/README.md`'s broken `../../audits/` link into the template itself, so future bootstraps don't reintroduce it. Verified with two isolated test repos (bash) and one (PowerShell): a repo with a pre-existing populated `DEFERRED_WORK.md` keeps it byte-for-byte after bootstrapping; a repo with none yet still gets the template seeded correctly. This tooling directory is not itself a git repo (no commit/PR to link).
**Status**: Fully resolved (2026-07-25) — both the register and the tooling that broke it are fixed and verified.

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

## 2026-07-26 Opencode Audit Remediation — Newly Deferred

### D-013: Gate workflow skips build/test (M-7)
**Scope**: `.github/workflows/gate.yml` + `scripts/verify.sh` advertise `build`/`test` checks but `verify.sh` detects no root lockfile and prints `::notice title=build::no build system detected...` — skipping actual build/test. The real build/test runs in `ci.yml` (separate workflow). Branch protection requires `gate` to pass, but `gate` doesn't exercise build/test.
**Impact**: If `ci.yml` were ever disabled/misconfigured, a PR could merge through `gate` green without build/test running.
**Proposed**: Add a root `package.json` with workspaces (`backend`, `ui`) or make `gate.yml` explicitly invoke `npm ci && npm run typecheck && npm test` in each subproject. Document which check is authoritative.
**Status**: Deferred — infrastructure hygiene, not a bug.

### D-014: RAILWAY_SETUP.md start command mismatch (M-8)
**Scope**: `RAILWAY_SETUP.md:26` says "The app starts with: `node src/index.js`". Actual runtime: `backend/railway.toml:6` `startCommand = "node dist/index.js"`; `backend/Dockerfile:55` `CMD ["node", "dist/index.js"]`; `package.json` `build` runs `tsc → dist/`. `src/index.ts` is TypeScript source — `node src/index.js` would fail (no such file).
**Impact**: Fresh operator following the doc fails to start the backend. Violates R23 (README + .env.example must let a fresh agent stand the repo up with no hidden steps).
**Proposed**: Update `RAILWAY_SETUP.md` to `node dist/index.js` (matching the actual deploy config).
**Status**: **✅ COMPLETED** (2026-07-26) — Updated `RAILWAY_SETUP.md` to `node dist/index.js`.

### D-015: ConfirmedBugs.md bug #11 doc/code mismatch (DM-1)
**Scope**: `ConfirmedBugs.md` entry 11 claims "`fix_pending → failed` is a bug, was fixed". Current `backend/src/portfolioAnalytics.ts:79-82` deliberately treats `fix_pending` as `failed` WITH a justifying comment ("Covers 'fix_pending' too: a fix PR being open isn't the same as merged — the repo's main branch is still red until the merge webhook confirms it.").
**Impact**: Either the prior audit overstated the fix, or a later commit reverted to original behavior. The code is internally consistent and defensible; the doc is stale.
**Proposed**: Per R15, annotate `ConfirmedBugs.md` entry 11 as "behavior is intentional per portfolioAnalytics.ts:80-82 comment — supersede this entry".
**Status**: **✅ COMPLETED** (2026-07-26) — Added R15 annotation note to `ConfirmedBugs.md` entry.

### D-016: auditOrchestrator.ts defense-in-depth `|| 'main'` fallback + all triggerAudit entry points
**Scope**: `backend/src/auditOrchestrator.ts:223` has `branchName: branchName || 'main'` as a final fallback for the git clone inside the audit. The M-6 fix only corrected the `weekly-audit` cron caller (`dailyReportWorker.ts:180`) to pass `getDefaultBranch()`. This fallback is the last-resort net — if ANY caller omits branchName, it defaults to 'main'.
**Impact**: Not a bug — intentional defense. Worth noting that `repoOps.ts:172` (CLI `/sentinel audit <repo>`) also hardcodes `'main'` and would hit this fallback, plus 4 other callers.
**Proposed**: Update all `triggerAudit` callers to use `getDefaultBranch()`.
**Status**: **✅ COMPLETED** (2026-07-26) — All 6 triggerAudit callers now use `getDefaultBranch()`:
- `repoOps.ts:172` (CLI `/sentinel audit <repo>`)
- `crossRepoCoordinator.ts:52` (cross-repo dependency audits)
- `repoOnboarder.ts:49` (initial audit on repo onboarding)
- `selfAuditor.ts:45` (self-audit of Sentinel repo)
- `telegramAI.ts:420` (AI-triggered audits)
- `dailyReportWorker.ts:180` (weekly-audit cron)
The `auditOrchestrator.ts:223` `branchName || 'main'` remains as defense-in-depth.

### D-017: Lockfile freshness — local node_modules mismatches
**Scope**: `npm ls` in both `backend/` and `ui/` shows version mismatches vs lockfile (e.g. `@anthropic-ai/sdk@0.104.1` vs `^0.115.0`). CI uses `npm ci` from consistent lockfile.
**Impact**: Local dev/test may behave differently than CI if local `node_modules` is stale.
**Proposed**: Run `npm ci` in both subprojects before any release-confidence claim. Add to onboarding docs.
**Status**: Deferred — standard hygiene.

### D-018: UI CVE audit gap (no `npm audit` gate for ui)
**Scope**: `npm audit --omit=dev` for `ui/` OOM'd in this Windows session. CI `ci.yml` ui job does not run `npm audit`; only backend has `--audit-level=high` gate.
**Impact**: No CI gate for UI-side critical/High CVEs.
**Proposed**: Add `npm audit --audit-level=high --production` to ui job in `ci.yml` (or run it in a separate scheduled job with more memory). Investigate why `ui/` audit OOMs locally (V8 heap limit).
**Status**: Deferred — needs CI adjustment + memory profiling.

### D-019: Secret-scan gate false positive on untracked `.env`
**Scope**: `scripts/verify.sh` (secret-scan job) flags `backend/.env` as "possible hardcoded secrets" even though the file is gitignored and not tracked (`git ls-files backend/.env` returns nothing).
**Impact**: `verify.sh` fails the secret-scan gate on every local run, masking real secret leaks if any. CI may or may not hit this depending on checkout behavior.
**Proposed**: Update `verify.sh` secret-scan to only scan tracked files (`git ls-files`) or explicitly exclude known gitignored paths like `**/.env*`. Document the false positive in onboarding.
**Status**: Deferred — verify script fix needed; not a code bug.

### D-020: Pre-existing uncommitted change in `backend/test/roundtable.test.ts`
**Scope**: `git status` showed ` M backend/test/roundtable.test.ts` before any of my edits — a pre-existing uncommitted modification from a prior session. I did not investigate what the change was, whether it conflicts with my M-2 roundtable fixes, or whether it should be committed/reverted.
**Impact**: Unknown test behavior change may be staged with my commit. Could be a fix, a test update, or a broken test.
**Proposed**: Diff the file against `HEAD` to identify the change; decide to commit, revert, or amend based on content.
**Status**: Deferred — needs triage.

### D-021: No UI test / build / lint verification
**Scope**: The fix scope was backend-only. I did not run `cd ui && npm test`, `npm run lint`, or `npm run build`. The repo rules require green CI including UI.
**Impact**: If GitHub Actions CI runs UI jobs on this branch, they are untested against my changes (api.ts, ci.yml, etc. could affect UI if they share types or contracts).
**Proposed**: Run `npm test && npm run lint && npm run build` in `ui/` locally (or wait for CI). Fix any breakage.
**Status**: Deferred — backend-only fix pass; UI verification pending.

### D-022: No end-to-end / integration verification
**Scope**: All verification was unit tests + static checks (tsc, yaml lint). I did NOT:
- Spin up Redis + run workers to verify H-1 cron behavior at runtime (first fire, then reschedule)
- Send a real Slack event to verify H-2 bot-message filter
- Trigger a real GitHub webhook redelivery after a simulated process restart to verify M-3 dedup persistence
- Test the dashboard `/api/command` endpoint with a real Telegram bot to verify M-5 chatId=0 handling
**Impact**: Mock-based tests prove code paths but not integrated system behavior. Real-world timing, network, and Redis persistence behaviors are untested.
**Proposed**: Run integration tests on a Docker-enabled runner (see D-002) with real Redis, real Slack webhook (ngrok), real GitHub webhook redelivery, real Telegram bot token.
**Status**: Deferred — blocked by no Docker in this environment (D-002/D-004).

### D-023: No PR opened / CI not verified on GitHub
**Scope**: Branch `fix/opencode-audit-remediation-2026-07-26` was pushed but no PR was opened. The required CI gate (secret-scan, build, test, doc-freshness, deploy-dry) has not run on this branch.
**Impact**: Per R30, merge requires green CI. The branch is unproven in the actual CI environment.
**Proposed**: Open PR via `gh pr create` or GitHub UI; watch all checks pass; address any failures (especially secret-scan false positive D-019 and any UI job failures D-021).
**Status**: Deferred — process step after code complete.

### D-024: Root and UI TypeScript configs not verified
**Scope**: `npx tsc --noEmit` ran clean from `backend/` only. I did not verify `tsc --noEmit` at repo root (if root tsconfig exists) or in `ui/`.
**Impact**: TypeScript errors in shared configs or UI could exist undetected.
**Proposed**: Run `npx tsc --noEmit` in `ui/` and at root if `tsconfig.json` exists.
**Status**: Deferred — quick verification step.

---

## 2026-07-29 Oracle Migration — Newly Deferred

### D-025: Replace Notion with an in-app dashboard view to decouple task tracking
**Scope**: Sentinel stored audit findings / sprint tasks in Notion via `NOTION_API_KEY`/`NOTION_DATABASE_ID` (see `notionClient.ts`). Now that the backend is self-hosted on Oracle with its own Postgres (see `docs/ORACLE_DEPLOY.md`), tasks are stored directly in Postgres instead.
**Backend done (2026-07-29)**: Added `projectDb.ts` (new `projects`/`project_changelog` tables) as a self-hosted replacement for the Notion "project database". `notionClient.ts` is now a thin shim delegating to it — same exported function names/signatures, so its 8 existing call sites (`repoOnboarder.ts`, `telegramAI.ts`, `telegramCommands.ts`, `sprintOrchestrator.ts`, `priorityEngine.ts`, `debugOrchestrator.ts`, `auditOrchestrator.ts`, `parallelExecutor.ts`) needed zero changes. Separately, the Notion mirror *inside* `writeTasksToNotion`/`updateNotionTaskStatus` (`auditTaskWriter.ts`) was removed — the two functions remain, under their original names, as Postgres-backed wrappers, since `audit_tasks` in Postgres was already the real source of truth. The 7 call sites that passed `task.notion_page_id` now pass `task.id` (the Postgres row id) instead. `NOTION_API_KEY`/`NOTION_DATABASE_ID`/`NOTION_TASKS_DATABASE_ID` are no longer read anywhere.
**Known gap**: existing repos' `projects` rows aren't backfilled (only newly-onboarded repos get one via `createNotionProject`/`createProject`), so `findNotionProject` returns null for already-onboarded repos until they're re-onboarded or manually inserted. All callers already fall back to the raw repo name when this happens, so this is a cosmetic gap (generic project name, no URL shown), not a functional break.
**Remaining**: lightweight dashboard view in the Sentinel UI to browse/edit tasks (`ui/`) — intentionally deferred per Shayan's call, to be picked up after the Oracle migration settles. `@notionhq/client` can also be dropped from `package.json` once nothing else references it.
**Status**: Backend decoupling complete (2026-07-29). UI view deferred — planned follow-up.

### D-026: Consider OmniRoute as a replacement for the hand-rolled builder pool
**Scope**: Shayan flagged [github.com/diegosouzapw/OmniRoute](https://github.com/diegosouzapw/OmniRoute) (33.6k stars) — a self-hosted AI gateway aggregating 290+ providers (90+ free) behind one OpenAI-compatible endpoint, with built-in quota-aware auto-fallback across providers. This overlaps significantly with what `builderRouter.ts` now hand-maintains (currently 22 models across NVIDIA NIM, Mistral, OpenRouter, Gemini, Kilo Gateway, each individually verified and wired in by hand).
**Why not done now**: Replacing the hand-rolled pool with OmniRoute is a real architecture change, not an incremental add — it means running OmniRoute as its own service (another container on the 1GB Oracle VM), vetting a third-party codebase that would intermediate every AI provider call, and re-verifying the whole builder/fallback pipeline against it instead of our own verified model list. Explicitly deferred per Shayan ("just consider it and maybe add it to the deferred") rather than integrated blind.
**Proposed resolution**: If picked up later — evaluate OmniRoute's resource footprint on the VM, whether it actually improves on our per-model verification (it aggregates *documented* free tiers, not necessarily verified working on every account), and whether its quota-tracking makes taskBuilder.ts's/aiderRunner.ts's own fallback-chain logic partially redundant or complementary.
**Status**: Deferred — noted for future consideration, not started.

### D-027: Autonomous PR review/fix/merge loop — roadmap
**Scope**: Shayan's vision for closing the loop between audits, builds, and PR review so Sentinel runs continuously per-repo without a human relaying review comments back into the fix cycle. Full design (2026-07-29):
1. Sentinel works continuously on **one branch per repo** (not one branch per batch) — accumulates commits across many task rounds. **Sentinel never auto-merges.** A human merges when ready, deletes the branch, and Sentinel starts a fresh one (possibly gated on human go-ahead to start).
2. Within that branch's lifetime: fix → push → CI/review comments → triage (valid vs. false-positive, judgment call) → fix → push → repeat until CI + review(s) are green, then stop and wait for human merge.
3. If no external reviewer (CodeRabbit) comments within some window, Sentinel's own agent self-reviews the diff and produces equivalent findings, so the loop never stalls waiting for a bot that isn't configured/responding.
4. Every audit report must be **multi-aspect**: security, functionality/correctness, backend, frontend, UX/accessibility, execution/performance, health/observability, documentation, testing/coverage, infra/deployment, dependencies/supply-chain, data/database. Each report states which aspect it covered, an honest 0-10 score for that aspect, the trend vs. the last audit of that same aspect, and the real-world *effect* of what changed (not code mechanics).
5. **Rotation policy**: no more than 3 sprints (10 tasks/sprint, so 30 tasks) focused on one aspect before the next audit is forced to pick a different one, round-robining through the list — prevents a repo only ever getting security attention while its docs/tests rot.
6. Post-merge, auto-trigger a fresh audit that also does roadmap-aware planning for the next ~10 tasks — for now, inferred from codebase/audit findings; a proper per-project roadmap doc/source-of-truth (a couple of projects already have one) is a separate follow-up Shayan and the agent will design together.
7. **Project memory**, scoped to the *repo* (must survive branch deletion) — persisted decisions, conventions, and dismissed findings (e.g. "the gpt_oss double-`openai/`-prefix is correct, don't re-flag it") fed into every audit/build/review prompt, the same way `conversationMemory.ts` already does for Telegram chat but currently nothing does for the audit/build agents.

**Completed (2026-07-29) — all 7 pieces**:
- **Item 1 — Branch-drift auto-rebase**: `utils/gitSync.ts`'s `rebaseOntoBase()`, wired into `taskBuilder.ts` — when the base branch moves during a batch, attempts an automatic rebase (force-with-lease push) instead of just warning; falls back to the original warning only on a real conflict. Directly motivated by PR #57 needing manual conflict resolution mid-session. Covered by real-git integration tests (`test/gitSync.test.ts` — actual temp repos, not mocked).
- **Item 2 — Loop-iteration guard**: `utils/loopGuard.ts`'s `LoopGuard` class — generic iteration cap + one-time human-escalation callback (Telegram alert distinct from routine per-task failure logs), retrofitted onto `taskBuilder.ts`'s and `aiderRunner.ts`'s builder-fallback loops (`LOOP_GUARD_MAX_ITERATIONS`, default 25). Today's fallback loops are already implicitly bounded by the builder pool size, so this is currently a defensive ceiling more than an active save — but it's the same mechanism item 3 needed, where there's no pool-size bound to fall back on at all.
- **Item 3 — Same-PR patch loop**: `projectDb.ts` persists a repo's accumulating `active_task_branch`/`active_pr_url`/`active_pr_number`; `taskBuilder.ts`'s `executeBatch()` clones and keeps pushing to that branch across batches instead of opening a new one every time (`createPullRequest()` already returned an existing open PR for a stable branch name — that behavior now actually gets exercised). `processPREvent.ts` clears the record once a human merges or closes the PR (guarded so a stale webhook can't clobber a newer record), so the next batch starts a fresh branch.
- **Item 4 — Self-review fallback**: `selfReviewer.ts` (new) fetches a Sentinel PR's diff and reviews it with the configured audit model when CodeRabbit hasn't produced a finding within `CODERABBIT_FALLBACK_DELAY_MIN` of the push (`scheduledJobsWorker.ts`'s `self-review-fallback` job, one per PR lifetime via a stable job id). Findings feed the same `createAuditTask` pipeline as CodeRabbit's, `source: 'self_review'`, `safeToAutoExecute: false`. Found and fixed a real bug along the way: `hasCodeRabbitAuditedCommit()` checked `audit_cycles.audit_agent = 'coderabbit'`, a field `createAuditCycle()` never actually sets to that value regardless of caller — silently always false, meaning the *existing* `CODERABBIT_FALLBACK_JOB` had been running its redundant audit on every human commit even when CodeRabbit had already responded. Fixed to check `audit_tasks.source` instead.
- **Item 5 — Multi-aspect audit + scoring + rotation**: `auditAspects.ts` (new) — 10-aspect round-robin (security, functionality, backend, frontend, ux_accessibility, performance, observability, documentation, testing, database), 3 sprints (audit cycles) per aspect before rotating, state persisted per repo (`projects.current_audit_aspect`/`aspect_sprint_count`). `claudeCodeAudit.ts`'s audit prompt focuses all 10 tasks on the assigned aspect and requires an aspect-scoped `aspectHealthScore` (0-10) and `aspectEffectSummary` (plain-English real-world impact, not code description, per Shayan's explicit framing) alongside the whole-repo score. Reports now show `🎯 Aspect focus: security (sprint 2/3)`, the aspect score + trend vs. the last audit of that same aspect, and the effect summary.
- **Item 6 — Project memory**: `projectMemory.ts` (new) — a `project_memory` table scoped to the repo (survives branch deletion, unlike a branch-local note) holding dismissed findings / conventions / prior decisions, fed into every audit (`claudeCodeAudit.ts`), self-review (`selfReviewer.ts`), and build-agent prompt (`taskBuilder.ts`, `aiderRunner.ts`). New commands: `/sentinel remember <repo> <text>`, `/sentinel forget <repo> <id>`, `/sentinel project-memory <repo>` (list) — named distinctly from the pre-existing single-word `/sentinel memory` (Telegram conversation history, a different feature) to avoid a collision.
- **Item 7 — Re-audit-after-merge trigger**: `processPREvent.ts` fires `triggerAudit()` right after a merged PR's tasks are marked done. Rule 1 (skip Sentinel-authored commits) doesn't need to change at all for this — the merge event's payload is deliberately attributed as a human action (`authorName: 'Human (PR merge)'`, no `sentinel/`-prefixed branch or `feat(sentinel):` commit message), which is honestly what a merge is, even though the underlying squash-merged commit on `main` may carry Sentinel's fingerprints. Rules 2/3 (queued-tasks / cooldown) still apply and bound how often this can fire — no infinite-loop risk, since a human merge is an infrequent, deliberate action.

**Status**: Complete — all 7 pieces shipped 2026-07-29. Remaining follow-up (not part of this roadmap, noted for later): a proper per-project roadmap doc/source-of-truth (item 6's original text mentioned this — Shayan and the agent will design it together separately), and a lightweight UI view for browsing project memory / aspect rotation state (currently Telegram-only).

---

## Notes for Future Agents

- Phase 2 error architecture is complete. The `AppError` class hierarchy in `src/errors/errors.ts` is the canonical error type. All new errors should subclass `AppError`.
- Lint for `.ts` files is temporarily disabled. Do not re-enable until `@typescript-eslint` releases a version compatible with TypeScript 7.
- The `.eslintrc.json` ignores `**/*.ts` via `ignorePatterns` (added 2026-07-17 to match this register). When lint for TS is re-enabled, remove `**/*.ts` from `ignorePatterns`.
- Phase 4 integration tests need Docker (D-002). Until then, raise coverage with mocked unit tests. The coverage gate in `jest.config.js` enforces no regression from the current baseline.
