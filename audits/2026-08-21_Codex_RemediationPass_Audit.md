# 2026-08-21 Codex Remediation Pass Audit

## Scope
- Second-pass, code-first remediation planning for the findings raised in `audits/2026-08-21_Codex_CodebaseExecutive_Audit.md`.
- Focused on implementation order, blast radius, and business impact.
- No code changes to runtime behavior in this pass; this is a prioritization and execution-sequencing artifact.

## Basis
- Direct re-inspection of:
  - `backend/src/index.ts`
  - `backend/src/startup.ts`
  - `backend/src/health.ts`
  - `backend/src/auditOrchestrator.ts`
  - `backend/src/sprintOrchestrator.ts`
  - `backend/src/parallelExecutor.ts`
  - `backend/src/repoDiscovery.ts`
  - `backend/src/taskBuilder.ts`
- Deferred-work register updated in the same pass:
  - `docs/governance/DEFERRED_WORK.md` entries `D-029`, `D-030`, `D-031`

## Summary
The next engineering pass should not start with refactoring for neatness. It should start with control-plane truthfulness.

The highest-value sequence is:
1. fix startup readiness semantics;
2. fix health/readiness signaling;
3. normalize default-branch handling across every executor;
4. only then split hotspots like `taskBuilder.executeBatch()` and `api.ts`.

The reason for this order is simple: the first three items reduce false confidence in the system. The latter items mainly reduce future change risk.

## Priority Order

### Priority 1 — Startup gating
**Why first**
- This is the most dangerous correctness issue because it allows the system to present as operational before it is actually ready.
- It affects every deploy, restart, crash recovery, and local boot.

**Code surface**
- `backend/src/index.ts`
- `backend/src/startup.ts`
- Any worker/bootstrap side effects transitively started from `bootstrapRuntime()`

**Minimum acceptable outcome**
- The server does not accept traffic until bootstrap has either completed successfully or failed explicitly.

**Recommended implementation shape**
- Move `app.listen()` behind awaited `bootstrapRuntime()`.
- If full boot-before-listen is too disruptive, add explicit in-memory readiness state and fail every non-health request until readiness flips true.
- On bootstrap failure, exit non-zero instead of logging the error and continuing to run a half-alive process.

**Risks**
- Startup time will become more visible.
- Existing deploy scripts or uptime checks may expose previously hidden dependency failures.

**Business effect**
- Fewer “it was up but broken” incidents.
- Higher confidence in deploys and autonomous restarts.

### Priority 2 — Health/readiness split
**Why second**
- Without this, fixing startup gating still leaves orchestration blind after boot.
- Current `/health` semantics hide dependency failure from anything relying on HTTP status.

**Code surface**
- `backend/src/health.ts`
- `backend/src/index.ts`
- Any deployment configs or external checks that currently call `/health`

**Minimum acceptable outcome**
- One endpoint answers “process alive?”
- One endpoint answers “system ready to serve traffic?”

**Recommended implementation shape**
- Keep `/health` as liveness if desired.
- Add `/ready` or equivalent strict readiness route that returns non-200 when Postgres or required queue dependencies are unavailable.
- Decide explicitly whether Notion/Slack/Telegram are required for readiness or merely reported.

**Risks**
- Existing hosts may need health-check reconfiguration.
- Some environments may reveal missing dependency setup that was previously masked.

**Business effect**
- Better traffic routing.
- Better deploy automation.
- Less hidden degradation.

### Priority 3 — Default-branch normalization
**Why third**
- This is the most direct portfolio-level execution bug after readiness.
- It causes repo-specific automation failure, which is especially expensive because it is non-uniform and hard to detect quickly.

**Code surface**
- `backend/src/auditOrchestrator.ts`
- `backend/src/sprintOrchestrator.ts`
- `backend/src/parallelExecutor.ts`
- `backend/src/repoDiscovery.ts`
- `backend/src/taskBuilder.ts`
- PR creation callers

**Minimum acceptable outcome**
- No core execution path hardcodes `'main'` when it is acting on an arbitrary portfolio repo.

**Recommended implementation shape**
- Resolve the default branch once per repo operation.
- Thread that value through batch context and PR creation context.
- Avoid scattering fallback string literals across callers.
- Preserve a final defense-in-depth fallback only at the lowest layer, not at business-logic entry points.

**Risks**
- Touches multiple execution surfaces at once.
- Needs regression tests for repos with non-`main` defaults.

**Business effect**
- Makes Sentinel actually portfolio-safe rather than “works on repos that happen to use main.”

## Secondary Work

### Priority 4 — Break up `taskBuilder.executeBatch()`
**Why not earlier**
- It is a maintainability risk, but the code can still operate if readiness and branch handling are fixed first.

**Suggested split**
- repo bootstrap/clone setup
- per-task execution loop
- builder fallback policy
- commit detection / dirty-tree reset
- post-batch rebase/push/finalization

**Expected gain**
- Lower regression risk in future automation changes.

### Priority 5 — Split `backend/src/api.ts`
**Why after executor correctness**
- It is broad, but it is not the current primary source of operational falsehood.

**Suggested split**
- portfolio/repo reads
- task actions
- sprint actions
- system actions
- settings/integrations

**Expected gain**
- Cleaner auth/policy review and lower route-change risk.

## Delivery Plan

### Pass A
- Startup gating
- Readiness route
- Minimal deploy-check adjustment

### Pass B
- Default-branch normalization for audit, sprint, and parallel executors
- Regression coverage for non-`main` repos

### Pass C
- `taskBuilder.executeBatch()` decomposition
- `api.ts` route-module split

## Recommended Acceptance Criteria
- A cold start cannot serve normal traffic before bootstrap completes.
- A broken Postgres or Redis dependency is visible via non-200 readiness.
- Audit, sprint, and parallel execution all work against a repo whose default branch is not `main`.
- No new string-literal branch assumptions are introduced in executor call paths.

## What I Would Not Do Yet
- I would not start by refactoring `taskBuilder.ts` for style alone.
- I would not widen scope into generalized architecture cleanup before the truthfulness issues are fixed.
- I would not rely on docs-only mitigation for the startup and readiness problems; these are code-contract issues.

## Status
- Completed: remediation sequencing pass and deferred-work recording.
- Deferred: implementation itself.
- Linked artifacts:
  - `audits/2026-08-21_Codex_CodebaseExecutive_Audit.md`
  - `docs/governance/DEFERRED_WORK.md`
