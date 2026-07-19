# Confirmed Bugs — Line-by-Line Codebase Review

> Method: every file in `backend/src/**/*.ts` (excluding `*.test.ts`) read in full, by hand, no subagents.
> This file is updated incrementally as files are reviewed — see the progress checklist at the bottom.
> A file with no bugs listed under it in "Findings" was read and found clean, not skipped.
> Started: 2026-07-18 (continuing from prior session's 18-file pass).

---

## Findings

### backend/src/telegramAI.ts
- **L63-66 — broken agent-routing regexes.** `pickSpeakingAgent()` uses `/\b(audit|analy|review|secur|score|report)\b/` and `/\b(debug|fail|broke|crash|log)\b/`. Partial-word tokens (`analy`, `secur`, `debug`, `fail`) followed by a trailing `\b` require a word boundary immediately after the token — but words like "analyze", "analysis", "security", "debugging", "failed" continue with more word characters, so `\b` never matches there. These tokens silently never fire on the very words they're meant to catch; messages fall through to the default agent instead.

### backend/src/webhook/processWebhook.ts
- **L33-38 — idempotency marked before the work it's guarding can fail.** `markAsProcessed(repoName, commitSha)` runs right after the dedup check, before the Notion lookup/update (L41-75) that can fail and `return`. A transient Notion error after this point means the commit is flagged "processed" forever — a GitHub webhook redelivery for that same event is dropped as a duplicate with no way to retry.

### backend/src/auditOrchestrator.ts
- **L329 — un-awaited async function interpolated into a Telegram message.** `COOLDOWN_HOURS` is `async (): Promise<number> => {...}` (L37-40). L80 correctly does `await COOLDOWN_HOURS()`. L329 does not: `` `Next audit available in ${COOLDOWN_HOURS()}h after next human commit.` `` — this sends the literal string "Next audit available in [object Promise]h..." every time a batch finishes with no remaining safe tasks.

### backend/src/taskBuilder.ts
- **L214 — missing `await` races dependency install against the build agent.** `runAiderForTask()` calls `installDependencies(repoPath);` with no `await`/`.catch`. `installDependencies` is `async` (`npm ci`/`npm install`/`pip install`). Aider starts immediately afterward in parallel instead of after deps finish installing — defeats the purpose of pre-installing deps for the common case, not just the documented failure-fallback case.

### backend/src/dbClient.ts
- **L178-180 (`updateDebugAttempt`) — latent SQL-injection-shaped pattern (not currently exploitable).** Column names are built directly from `Object.keys(updates)`: `` `${k} = $${i + 3}` ``. Currently safe — the only 4 call sites (all in `debugOrchestrator.ts`) pass hardcoded literal keys — but there's no allowlist, so the next caller that passes a dynamic key becomes an injection point. Not a live bug; flagged as a footgun.

### backend/src/api.ts
- **L238 (`GET /agent-room/messages`) — unguarded `parseInt` on query param.** `Math.min(parseInt(req.query.limit || '50'), 200)` — a non-numeric `?limit=` value produces `NaN`, which is passed straight into `LIMIT $1` against Postgres (a runtime DB error instead of a 400).

### backend/src/commands/repoOps.ts + backend/src/deduplication.ts
- **`/sentinel webhook-status` queries a table that is never created or written to.** `handleRepoOpsCmd`'s `webhook-status` case (repoOps.ts L393-427) does `SELECT ... FROM processed_commits ...`. Grepping the entire codebase, `processed_commits` appears in exactly this one query — there is no `CREATE TABLE processed_commits` anywhere and nothing ever inserts into it. The actual dedup mechanism (`deduplication.ts`) is a pure in-memory `Map` (`store`), never touches Postgres. The query throws "relation does not exist", which is swallowed by `.catch(() => ({ rows: [] }))` (L403), so `seen.rows` is always empty and **every repo is reported as "❌ no webhook events in 7 days" even when webhooks are working perfectly.** This command is permanently broken and actively misleading.

### backend/src/autoApprover.ts + backend/src/correlationEngine.ts — systemic issue
- **In-memory `setTimeout` used for hours-to-days-long scheduled work, with no recovery after a process restart.** Two independent subsystems rely on a live `setTimeout` surviving unattended for a long window:
  - `autoApprover.ts` L23-44 — schedules sprint auto-approval 2 hours out via `setTimeout`, backed by a Redis key with a matching TTL for *cancellation* lookups, but nothing re-arms the timer if the process restarts. If Railway redeploys (which this very system triggers on every merged PR) within that 2h window, the Redis key still says "pending" (`isPendingAutoApprove()` returns true) but the timer that would actually call `approveSprint()` is gone forever — the sprint silently never auto-approves, and the UI/bot continues to claim one is pending.
  - `correlationEngine.ts` L23-25 — schedules `checkPostMergeImpact()` **48 hours** after every PR merge via bare `setTimeout`, with zero persistence. Given this system redeploys itself on merged PRs (that's the product), the process almost certainly restarts well within 48h of any tracked merge, meaning `checkPostMergeImpact` — and therefore all "PR Impact Analysis" Telegram messages — likely never fire in production despite `pr_impact` rows being created and looking like tracking is active.

### backend/src/health.ts
- **L92 — `dryRunMode` is computed correctly then unconditionally clobbered.** L13 sets `dryRunMode: process.env['DEBUGGER_DRY_RUN'] === 'true'` into the response object. L92, right before `res.json(health)`, does `health['dryRunMode'] = false;` unconditionally — overwriting whatever was just computed. `/health` always reports `dryRunMode: false` even when `DEBUGGER_DRY_RUN=true` is actually set, which is exactly the flag an operator would check to confirm dry-run mode is active before trusting the debugger not to make live changes.

### backend/src/errors/errorClasses.ts — dead code (not a runtime bug)
- A complete second error taxonomy (`SentinelError`, `ErrorCode` enum, `ValidationError`, `NotFoundError`, `UnauthorizedError`, `ForbiddenError`, `InternalError`, `BuilderError`, `AuditError`, `AIProviderError`) exists here in parallel with the one actually used in production (`errors/errors.ts`'s `AppError` hierarchy, imported by `index.ts`). Grepped the whole codebase — `errorClasses.ts` is never imported anywhere except by `errors/index.ts`'s barrel `export *`, which itself is never imported either. Confusing duplication, not a behavioral bug.

### backend/src/securityDb.ts — issue lifecycle never closes
- **`security_issues.status` is never set to anything other than `'open'`, and `resolved_at` is never written, anywhere in the codebase.** Grepped every write path (`securityPatcher.ts`, `securityScanner.ts`, all `commands/*.ts`) — there is no "mark issue resolved/fixed" call anywhere. Consequences, both confirmed by reading the read-paths that depend on this: (1) `getOpenIssues()` (used by `/sentinel security <repo>`) will keep showing an issue as open forever, even after `applySecurityPatches()` successfully opens and presumably merges a fix PR for it. (2) `getIssuesResolvedSince()` (used by `monthlySecurityReport.ts`) can only ever return `0`, so the monthly report's "Issues resolved" line is permanently zero regardless of actual remediation activity.

### backend/src/sprintOrchestrator.ts
- **L139 — wrong ID type passed to `updateNotionTaskStatus`.** `updateNotionTaskStatus(notionPageId, status, extra)` (defined in `auditTaskWriter.ts`) expects a Notion page-ID string as its first argument and does `notion().pages.update({ page_id: notionPageId, ... })`. `executeNextSprintTask()` calls it as `updateNotionTaskStatus(task.audit_task_id, 'build_check', {...})` — `task.audit_task_id` is the **numeric Postgres FK** (`sprint_tasks.audit_task_id → audit_tasks.id`), not a Notion page ID. Every sprint-originated task that has a linked audit task will fail this Notion sync call with an invalid `page_id`; the failure is swallowed by `updateNotionTaskStatus`'s own try/catch (`logger.warn(...'Could not update Notion task status')`), so it fails silently every time rather than erroring loudly. The correct value would need to be looked up from `audit_tasks.notion_page_id` via `task.audit_task_id`, not passed directly.

### backend/src/selfHealer.ts — no alert-repeat cooldown
- **`checkAndHeal()` sends a full Telegram alert on every single call, with no debounce.** `reportFailure()` calls `checkAndHeal()` after every recorded component failure, and `checkAndHeal()` sends "Sentinel Self-Healing Alert" whenever `getDegradedComponents()` returns anything (`status IN ('degraded','failed')`). Once a component crosses the 3-failure threshold, every subsequent failure re-sends the same alert — there's no last-sent timestamp or cooldown gate, unlike the equivalent pattern already used elsewhere in this codebase (`queueClient.ts`'s Redis-error alert has a hard-coded 5-minute `lastRedisAlertAt` cooldown). A component failing repeatedly (e.g. once per audit cycle) will spam the same alert every time instead of once per state transition.

### backend/src/velocityTracker.ts + backend/src/portfolioAnalytics.ts — dead status value
- **`debug_attempts.status` is never set to `'resolved'` anywhere in the codebase**, but two separate consumers assume it is. Grepped every write path to `debug_attempts` (`dbClient.ts`'s `createDebugAttempt`/`incrementAttempt`/`updateDebugAttempt`/`stopDebugAttempts`, called only from `debugOrchestrator.ts`) — the only statuses ever written are `'in_progress'`, `'exhausted'`, `'dry_run'`, `'fix_pending'`, `'failed'`, `'stopped'`. `'resolved'` does not exist as a real value.
  - `velocityTracker.ts` L29-32: `buildsFixed` is computed via `SELECT COUNT(*) FROM debug_attempts WHERE status = 'resolved' ...` — this can only ever return 0. The weekly velocity report's "builds fixed" line, and `velocity_metrics.builds_fixed`, are permanently zero regardless of how many builds the debug loop actually fixed.
  - `portfolioAnalytics.ts` L76 (`getRepoStats`, used by the health-score fallback path when there's no `build_poll_jobs` row yet): `else if (latestStatus === 'resolved') buildStatus = 'passing';` — dead branch, never taken. The next branch, `else if (latestStatus && latestStatus !== 'stopped') buildStatus = 'failed';`, catches `'fix_pending'` too — meaning **a repo whose build was successfully auto-fixed (debug attempt status `fix_pending`, PR opened) gets reported as `buildStatus: 'failed'`** by this fallback path, which then depresses its computed `health_score` even though the fix already landed. This is a real, user-visible correctness bug in the health scoring the whole dashboard/reports are built on.

---

## Progress checklist (106 files total)

- [x] telegramAI.ts — bug found
- [x] api.ts — bug found
- [x] index.ts — clean
- [x] dbClient.ts — latent issue found
- [x] webhook.ts — clean
- [x] webhook/processWebhook.ts — bug found
- [x] webhook/processPREvent.ts — clean
- [x] webhook/messages.ts — clean
- [x] queueClient.ts — clean (DLQ-no-consumer already tracked in repo's own DEFERRED_WORK.md, not new)
- [x] workers.ts — clean (barrel re-export)
- [x] workers/buildPollWorker.ts — clean
- [x] debugOrchestrator.ts — clean
- [x] securityScanner.ts — clean
- [x] securityPatcher.ts — clean
- [x] auditOrchestrator.ts — bug found
- [x] taskBuilder.ts — bug found
- [x] aiderRunner.ts — clean
- [x] telegramCommands.ts — clean
- [x] agentRoom.ts — clean
- [x] agentBots.ts — clean
- [x] agentDb.ts — clean
- [x] agentLeaderboard.ts — clean
- [x] agentPersonality.ts — clean
- [x] agentRegistry.ts — clean
- [x] agentReplies.ts — clean
- [x] agentStandup.ts — clean
- [x] aiOutputValidator.ts — clean
- [x] auditDb.ts — clean
- [x] auditTaskWriter.ts — clean
- [x] autoApprover.ts — bug found (systemic, see above)
- [x] buildPoller.ts — clean
- [x] builderRouter.ts — clean
- [x] businessDb.ts — clean
- [x] businessMetrics.ts — clean
- [x] capacityManager.ts — clean
- [x] ceoReport.ts — clean
- [x] claudeCodeAudit.ts — clean
- [x] claudeCodeRunner.ts — clean
- [x] commands/agents.ts — clean
- [x] commands/repoOps.ts — bug found (webhook-status)
- [x] commands/reports.ts — clean
- [x] commands/sprint.ts — clean
- [x] conflictDetector.ts — clean
- [x] conversationMemory.ts — clean
- [x] correlationEngine.ts — bug found (systemic, see above)
- [x] costTracker.ts — clean
- [x] costpilotClient.ts — clean
- [x] crossRepoCoordinator.ts — clean
- [x] dailyReport.ts — clean
- [x] deduplication.ts — bug found (webhook-status, see above)
- [x] dependencyScanner.ts — clean
- [x] errors/codes.ts — clean
- [x] errors/errorClasses.ts — dead code (noted)
- [x] errors/errors.ts — clean
- [x] errors/index.ts — clean
- [x] errors/sentry.ts — clean
- [x] extractPayload.ts — clean
- [x] githubMetricsSyncer.ts — clean
- [x] health.ts — bug found
- [x] integrationsStatus.ts — clean
- [x] logger.ts — clean
- [x] metricsFetcher.ts — clean
- [x] monthlySecurityReport.ts — clean
- [x] notionClient.ts — clean
- [x] notionDashboard.ts — clean
- [x] owaspChecker.ts — clean
- [x] parallelExecutor.ts — clean
- [x] patternDetector.ts — clean
- [x] performanceTracker.ts — clean
- [x] portfolioAnalytics.ts — clean
- [x] portfolioDb.ts — clean
- [x] prCreator.ts — clean
- [x] priorityEngine.ts — clean
- [x] promptOptimizer.ts — clean
- [x] providerHealthCheck.ts — clean
- [x] repoDiscovery.ts — clean
- [x] repoLock.ts — clean
- [x] repoOnboarder.ts — clean
- [x] repoResolver.ts — clean
- [x] riskAssessor.ts — clean
- [x] roiScorer.ts — clean
- [x] secretScanner.ts — clean
- [x] securityDb.ts — bug found (issue lifecycle)
- [x] selfAuditDb.ts — clean
- [x] selfAuditor.ts — clean
- [x] selfHealer.ts — bug found (no alert cooldown)
- [x] selfScaler.ts — clean
- [x] sentinelBrain.ts — clean
- [x] settingsDb.ts — clean
- [x] settingsLoader.ts — clean
- [x] sprintDb.ts — clean
- [x] sprintOrchestrator.ts — bug found (wrong ID to Notion)
- [x] sprintPlanner.ts — clean
- [x] taskBuilder.ts — bug found (see top, session 1)
- [x] telegramAI.ts — bug found (see top, session 1)
- [x] telegramClient.ts — clean
- [x] telegramCommands.ts — clean (session 1)
- [x] telegramMenus.ts — clean
- [x] types/sentry-express.d.ts — clean
- [x] types/tmp.d.ts — clean
- [x] utils/childEnv.ts — clean
- [x] utils/execAsync.ts — clean
- [x] utils/safeFire.ts — clean
- [x] utils/timingSafeCompare.ts — clean
- [x] velocityTracker.ts — bug found (dead 'resolved' status)
- [x] webhook.ts — clean (session 1)
- [x] webhook/messages.ts — clean (session 1)
- [x] webhook/processPREvent.ts — clean (session 1)
- [x] webhook/processWebhook.ts — bug found (session 1)
- [x] weeklyBusinessReport.ts — clean
- [x] workers.ts — clean (session 1, barrel)
- [x] workers/agentCleanupWorker.ts — clean
- [x] workers/buildPollWorker.ts — clean (session 1)
- [x] workers/dailyReportWorker.ts — clean
- [x] workers/sprintWorker.ts — clean

**Status: COMPLETE — 106/106 files reviewed** (18 in the first pass of this session, 88 in the second pass). Every `.ts` file in `backend/src/` (excluding `*.test.ts`) has been read in full.

---

## Summary

**11 confirmed bugs found**, all independently verifiable by reading the cited file/line:

1. `telegramAI.ts:63-66` — broken partial-word regexes in agent-routing (`analy`, `secur`, `debug`, `fail` + trailing `\b` never match their intended full words)
2. `webhook/processWebhook.ts:33-38` — idempotency marked before the Notion work that can fail, silently dropping retries forever on transient errors
3. `auditOrchestrator.ts:329` — un-awaited async function → literal `[object Promise]` sent to Telegram
4. `taskBuilder.ts:214` — missing `await` on `installDependencies()`, races npm/pip install against the build agent starting
5. `commands/repoOps.ts` + `deduplication.ts` — `/sentinel webhook-status` queries a `processed_commits` table that is never created or written to; always reports every repo as missing webhooks
6. `autoApprover.ts` + `correlationEngine.ts` — in-memory `setTimeout` for 2h/48h scheduled work with no persistence; likely never fires in production because this system redeploys itself on the very merges it's tracking
7. `health.ts:92` — `dryRunMode` computed correctly then unconditionally overwritten to `false`
8. `securityDb.ts` — `security_issues.status`/`resolved_at` never transition away from `'open'`; open-issue lists and the monthly "resolved" count are permanently stale/zero
9. `sprintOrchestrator.ts:139` — passes the numeric `audit_task_id` where a Notion page-ID string is expected; fails silently every time
10. `selfHealer.ts` — no cooldown on repeated self-healing alerts, unlike the equivalent pattern elsewhere in the codebase
11. `velocityTracker.ts` + `portfolioAnalytics.ts` — both depend on a `debug_attempts.status` value (`'resolved'`) that is never written; zeroes out the "builds fixed" metric and misreports successfully auto-fixed repos as `'failed'` in the health-score fallback path

Plus one dead-code note (`errors/errorClasses.ts` — a full second, unused error taxonomy) and two minor input-validation gaps (`api.ts` unguarded `parseInt`, `dbClient.ts`'s `updateDebugAttempt` building column names from object keys — safe today, latent risk).

No bugs were found in the other ~85 files — read in full, not skipped.

*(The `- [ ] ...` tail and "IN PROGRESS — 19/106" line that used to follow here were leftover from an interrupted edit in the same session that produced the "COMPLETE — 106/106" line above — the file was self-contradictory. Removed 2026-07-19; the 106/106 COMPLETE status above is the accurate one, confirmed by the fixes and re-scan below.)*

All 11 bugs above were fixed and committed 2026-07-19 (commit `f0a2173`), verified against 256 passing tests and a clean `tsc --noEmit`.

---

## Pass 2 — 2026-07-19: full re-read of backend/src + first-ever pass on ui/

Same "read every line, don't skip" method, extended to the `ui/` Next.js dashboard, which Pass 1 never covered at all. Found 5 more real bugs (commit `db9fcd6`) — bringing the running total to 16:

12. **`sprintOrchestrator.ts` — sprint continuation used a bare `setTimeout`.** Same failure class as bug #6 above (which fixed `autoApprover.ts`/`correlationEngine.ts` but missed this one): a process restart mid-sprint permanently stranded it in `'executing'` with the remaining tasks never running. Fixed by moving to the same BullMQ scheduled-jobs queue.
13. **`auditOrchestrator.ts` — the 24h audit-approval-timeout had the identical bare-`setTimeout` bug.** A redeploy inside that window left the audit cycle in `'awaiting_approval'` forever, expiry never firing. Same fix.
14. **`notionClient.ts` / `repoOnboarder.ts` — `createNotionProject` was called but never existed.** `repoOnboarder.ts` feature-detects `notionClient.createNotionProject` before calling it; that function had never been implemented, so every auto-onboarded repo silently skipped Notion page creation while the operator was unconditionally told "Notion row created ✅" regardless. Implemented the function (with a minimal-fields retry if the full property set doesn't match the live Notion database's schema — **the actual property names were inferred from other code in the repo, not verified against a real Notion API call**, so this may still need adjustment against the real database). Made the onboarding summary message report per-step success/failure honestly instead of always claiming success.
15. **`telegramAI.ts` — field-name mismatch silently nulled task complexity.** The natural-language `create_task` chat action called `createAuditTask({ estimatedComplexity: 'medium', ... })`, but `auditDb.createAuditTask` reads a field named `complexity`. Because the call goes through an untyped `require()`, `tsc` never caught the mismatch — every task created via chat got `complexity: NULL` in Postgres instead of `'medium'`.
16. **`ui/app/api/action/route.ts` — the UI action-proxy allowlist blocked buttons that work on the backend.** This is `TODO.md`'s P2-15 ("dashboard buttons call non-existent backend routes") — except the backend routes DO exist; the real bug was the proxy's literal-string `Set` allowlist, which (a) can't match dynamic routes at all (`/api/agents/:id/toggle`, `/api/repo/:name/audit`, `/api/security/issue/:id/patch`) and (b) listed some static paths under names the UI never actually calls (`/api/telegram/command`, which no UI code calls, instead of the real `/api/command`), while omitting `/api/system/audit-all` and `/api/system/security-scan` entirely. Net effect: **Audit All, Run Security Scan, Self-Audit, pause-sprint, per-repo audit, per-agent toggle, and security-patch all silently 403'd** in the dashboard. Replaced the Set with a regex allowlist covering every route the UI actually calls (verified by grepping every `callAction(...)` call site in `ui/`).

**Verification for pass 2 (at the time it was written):** `npm test` (backend) → 34 suites / 256 tests passing; `npx tsc --noEmit` clean for both `backend/` and `ui/`. Regression tests added for bugs 12, 13, 14, 15. At that point nothing had actually been run — see the update below, which closes part of that gap.

**Update — same day, after a user request to actually verify runtime behavior:** the backend (`node dist/index.js`) and the UI (`next dev`) were both booted as real local processes, using dummy/blank secrets so no live Notion/Telegram/GitHub call could succeed or send anything real. This is a *manual, one-off smoke test*, not part of the automated suite:
- `/health` genuinely reflects `dryRunMode` toggling with `DEBUGGER_DRY_RUN` (confirms an earlier pass-1 fix live, not just via unit test)
- webhook signature checks return real `401`s, unknown routes real `404`s, `/api/portfolio` a clean `500` with no DB configured (no crash)
- bug 16 specifically: `POST /api/action` with `/api/system/security-scan` and the dynamic `/api/repo/tapcash/audit` / `/api/agents/nvidia/toggle` — all three previously guaranteed `403` — now reach the backend; a path-traversal attempt still correctly gets `403`
- all 12 default watched repos (acc, tapcash, AlphonsoEcosystem, session-guard, costpilot, shiporex, aegis, mint, agents-ops-board, founder-social-club, obsidian-studio, obsidian-media) were each driven through the real UI → proxy → backend `triggerAudit()` path; the backend logged an expected `"DATABASE_URL not configured"` failure for each (correct given no DB was wired up) with no crash
- **New finding from this exercise, not fixed:** `auditDb.initAuditSchema()` isn't guarded like `dbClient.initSchema()` — with no `DATABASE_URL`, it throws unhandled and aborts the rest of the startup sequence (workers, bot command registration, agent pool init never run). Real Railway deployments always set `DATABASE_URL`, so this likely doesn't bite in practice, but it was never visible before actually booting without a DB.

**Still NOT verified (still true after the manual boot above):**
- No real Postgres or Redis was used — the manual boot ran with `DATABASE_URL`/`REDIS_URL` both unset, so BullMQ scheduled-job persistence-across-restart (bugs #6, 12, 13) is still resting on BullMQ's documented behavior, not something exercised here.
- No real Notion API key was used — `createNotionProject`'s property names (bug 14) are still inferred from patterns elsewhere in the code, not confirmed against the real Notion database schema.
- No real Telegram bot/chat was used — nothing has confirmed an actual Telegram message renders/arrives correctly.
- Generic/presentational UI files (shadcn primitives in `ui/components/ui/*`, `ui/lib/data.ts`, `ui/lib/types.ts`, `ui/lib/toast.ts`, `ui/lib/utils.ts`) were not individually line-audited — lower risk (little/no business logic) but not confirmed clean the way the rest of this document's coverage was.

---

## Pass 3 — 2026-07-19: CodeRabbit review on PR #33, applied same day

PR #33 (branch `fix/pass2-e2e-audit-fixes`) bundled passes 1+2 and was reviewed by CodeRabbit (installed on this repo — confirmed via its bot comments on prior merged PRs, not assumed). CodeRabbit posted 7 actionable findings plus 1 nitpick against the diff — a mix of issues in pass 2's own new code and pre-existing code the diff happened to touch. Each was independently verified against the current code (not just trusted at face value) before fixing:

17. **`sprintOrchestrator.ts` — `SPRINT_CONTINUE_JOB` reused the same BullMQ `jobId` (`sprint-continue:${sprintId}`) across every task completion in a sprint.** Confirmed real and serious: BullMQ's `queue.add()` with a `jobId` that already exists (even completed) returns the existing job instead of scheduling a new delayed one. This meant the very first continuation after task 1 would work, and every continuation after that would silently no-op — bug 12 above would have appeared fixed for single-task sprints and been silently broken for every multi-task sprint. Fixed by keying the jobId on the just-completed task's id instead of the sprint id.
18. **`repoOnboarder.ts` / `auditOrchestrator.ts` — `triggerAudit()` returned `void`, so `.then(() => true)` reported "First audit triggered ✅" even when `triggerAudit` didn't actually start one** (audit disabled, repo locked, rule-checked rejected, active cycle already exists). Fixed by giving `triggerAudit` an explicit `{ started: boolean; reason?: string }` return value and updating `repoOnboarder.ts` to only report success when `started` is true. All 9 other call sites of `triggerAudit` were checked and don't depend on the old `void` return, so this is a non-breaking, additive change.
19. **`notionClient.ts` — `createNotionProject`'s minimal-property retry ran on *any* create failure**, not just schema mismatches. A transient network blip or rate limit would silently retry with fewer fields instead of surfacing the real error, creating a degraded Notion page. Fixed to only retry-minimal when the SDK reports `err.code === 'validation_error'`.
20. **`ui/app/api/action/route.ts` — the regex allowlist's `[\w.-]+` segment pattern technically accepts a literal `.` or `..` as the whole segment value** (e.g. `/api/repo/../audit` matches the `/api/repo/[\w.-]+/audit` pattern as written), and `fetch()`'s URL normalization would then collapse that to a different path than what was validated. Fixed by explicitly rejecting any path with a `.`/`..` segment before the allowlist regex runs.
21. **`api.ts` — `?limit=` on `/agent-room/messages` wasn't clamped to a positive number.** `Number.isFinite(-5)` is `true`, so a negative limit passed straight through to `LIMIT $1` in Postgres, which rejects negative `LIMIT` values. Fixed to fall back to the default (50) for any non-positive value.
22. **`commands/repoOps.ts` — `/sentinel security-approve` couldn't distinguish "0 issues were open" from "the database call failed."** A DB error was silently coerced to `count = 0`, producing the same success-looking message as a genuine zero-issue result. Fixed to send a distinct failure message when the underlying call actually threw.
23. **`commands/repoOps.ts` — `/sentinel webhook-status` labeled its count "events."** `portfolio_metrics` is an append-only snapshot table written by both the webhook handler and the periodic metrics sync, so the count reflects metric snapshots, not discrete webhook deliveries. Renamed the field/label to "snapshots" / "metric activity" throughout.
24. **`webhook/processWebhook.ts` — deferring `markAsProcessed` until after the Notion round-trip (the original pass-1 fix for bug #2) widened the redelivery race window**: a near-simultaneous webhook redelivery arriving while the first request was still awaiting Notion could slip past the dedup check and fully re-run Notion updates, changelog appends, Telegram messages, security scans, and build-check enqueues. Fixed with a proper claim-then-release pattern: `deduplication.ts` gained an `unmarkProcessed()` function; `processWebhook.ts` now claims immediately (closing the race window) and releases the claim only on the specific failure paths that should allow a genuine retry (Notion search/update errors) — preserving the original bug's fix while closing the new gap CodeRabbit found.
25. *(Nitpick, not counted above)* **`telegramAI.ts`'s routing regex over-corrected pass 1's fix** — removing the trailing `\b` fixed the intended stems (`analy`, `secur`, `debug`, `fail`) but was applied to the *entire* alternation group, including already-complete words (`audit`, `review`, `score`, `report`, `broke`, `crash`, `log`) that never had the boundary problem. This made e.g. "reporter", "scorecard", "reviewable", "crashpad" incorrectly match. Restored `\b` on both sides for the complete-word terms while keeping `\w*` stem-matching only for the four terms that actually need it.

**Verification for pass 3:** all fixes pushed to PR #33; re-ran full backend test suite plus updated `webhook.test.js` (claim/release semantics), `telegramAI.pickSpeakingAgent.test.ts` (negative over-match cases) — see the PR's CI run for the actual pass/fail count, not asserted here from memory. `npx tsc --noEmit` re-run clean.

**Still not verified after pass 3:** none of these fixes were manually smoke-tested the way bug 16 was in the pass-2 update above — they're covered by unit tests and `tsc`, not a live click-through. The `SPRINT_CONTINUE_JOB` fix (17) in particular can only be truly proven by watching a real multi-task sprint execute against a real Redis, which hasn't happened.
