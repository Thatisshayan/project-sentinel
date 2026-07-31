# Audit: Functional-Correctness Pass — Core Webhook → Audit → Build → PR Pipeline

**File**: `audits/2026-07-31_Claude_FunctionalCorrectness_Audit.md`
**Date**: 2026-07-31
**Agent**: Claude (Sonnet 5)
**Scope**: Code-level functional-correctness review of the core runtime pipeline: `webhook.ts`, `webhook/processWebhook.ts`, `webhook/processPREvent.ts`, `auditOrchestrator.ts`, `taskBuilder.ts`, `queueClient.ts`, `buildPoller.ts`, `sprintOrchestrator.ts`, `debugOrchestrator.ts`, `parallelExecutor.ts`, `prCreator.ts`. Not a full 120-file sweep — targeted at the money-path (the sequence that turns a push/audit into a merged PR), since that's where a functional bug has the most real-world consequence.
**Status**: 3 real bugs found, all fixed same-day across 2 PRs.

---

## Rule 3 Compliance: Truthfulness

| Claim | Verified? | Evidence |
|---|---|---|
| `tsc --noEmit` clean after each fix | ✅ Yes | Ran `npx tsc --noEmit` in `backend/` after each of the 2 fix commits — zero errors both times |
| Full test suite passes after each fix | ✅ Yes | Ran `npm run test` — 548/548 tests, 66/66 suites, both times |
| `parallelExecutor.ts` already handles this correctly | ✅ Yes | Read the full `createPullRequest()` call site (lines 95-170) — it independently re-verifies the PR exists on GitHub via a live API call before marking the task complete, and marks it `failed` with a loud alert if not found. No fix needed there. |
| 4 total *callers* of `createPullRequest()` in the codebase | ✅ Yes, corrected | Originally cited `grep -rn "createPullRequest(" --include="*.ts" backend/src` as returning "exactly 4" — Qodo correctly flagged that this pattern also matches the function's own definition in `prCreator.ts`, so the actual match count is 5, not 4. Re-run: `grep -rn "createPullRequest(" --include="*.ts" backend/src \| grep -v "\.test\.ts"` returns 5 lines (4 `await createPullRequest(` call sites + 1 `async function createPullRequest(` definition). The underlying claim — 4 callers — was correct; the cited evidence command was not. |

**One correction recorded** (2026-07-31, second pass, in response to PR #62 review comments): the grep evidence above was wrong as originally stated; fixed to accurately describe what the command returns. See also the corrected file-size table below (was: brittle exact line counts that drifted out of sync with `main` once the fix PRs' diffs were accounted for).

---

## Rule 5 Compliance: Audit Basis

### Code Inspection (primary source)
- Full read of `webhook.ts`, `webhook/processWebhook.ts`, `webhook/processPREvent.ts` — signature verification, dedup claiming, notion/postgres error handling, PR-merge task-status transitions. (Note: exact line counts deliberately omitted here — Qodo correctly flagged that the counts in an earlier version of this doc were snapshotted before the fix PRs landed and drifted out of sync with the repo state by the time this doc was read. Run `wc -l <file>` against the current `main` if an exact count is needed; this doc records what was inspected, not a byte-exact line count that will inevitably go stale.)
- Full read of `auditOrchestrator.ts` — the 4 loop-prevention rules, audit trigger, batch execution loop, approval-timeout scheduling.
- Full read of `taskBuilder.ts` — the builder-fallback loop, git reset/rebase-on-drift logic, aider process spawning.
- Full read of `queueClient.ts`, `buildPoller.ts` — BullMQ queue wiring, GitHub Actions/Vercel/Railway status polling.
- Full read of `sprintOrchestrator.ts`, `debugOrchestrator.ts`, `parallelExecutor.ts` (relevant section), `prCreator.ts`.
- Targeted grep sweep for the same bug class elsewhere: `grep -rn "createPullRequest(" --include="*.ts" . | grep -v "\.test\.ts"` to find every call site once the pattern was confirmed in one place (5 matches: 4 callers + 1 definition — see corrected Rule 3 table entry above).

### Docs Reference
- `docs/governance/DEFERRED_WORK.md` — read in full before this pass; none of D-001–D-027 covered this bug class.
- `audits/2026-07-25_Hermes_PostAuditRemediation_Audit.md`, `audits/2026-07-25_Opencode_FullRepo_Audit.md` — read for context; no overlapping findings on this specific pipeline.

---

## Findings & Remediation

### Finding 1 (Major) — `createPullRequest()` failures were silently swallowed by 3 of its 4 callers
**Root cause**: `prCreator.ts`'s `createPullRequest()` catches every error internally (GitHub rate limit, auth hiccup, transient 5xx, network blip) and returns `{ prUrl: null, prNumber: null }` instead of throwing. This is a reasonable API shape — but 3 of its 4 callers never checked for the null case before proceeding as if the PR succeeded.

**Impact by call site**:
- `auditOrchestrator.ts` (`processNextBatch`) — completed batch work got marked `build_check` with a `null` PR URL. Nothing polls or webhooks off a PR that doesn't exist, so the batch's real, already-pushed commits would sit invisibly stuck forever, with the human-facing "Batch Ready ✅" message just showing a blank PR line and no error.
- `sprintOrchestrator.ts` (`executeNextSprintTask`) — **more severe**: the sprint task was marked **`done`** (a terminal status), so a PR-creation failure would be silently counted as a shipped, completed sprint task forever, even though nothing merge-able was ever produced.
- `debugOrchestrator.ts` (`orchestrateDebug`) — the debug attempt was marked `fix_pending` and the human-facing message said "Fix Ready for Review 🔧" with instructions to "merge the PR" — except no PR exists. Nothing except a merged PR ever resolves `fix_pending`, so the attempt (and its one consumed retry) would be stuck forever.
- `parallelExecutor.ts` — **already correct**, no fix needed. It independently re-verifies the PR actually exists on GitHub via a live API call before marking the task complete, and marks it `failed` with a loud, actionable alert if the PR isn't found. This is the pattern the other 3 call sites should have followed from the start.

**Why this matters beyond the 3 call sites**: this is the same "make failures visible instead of letting state quietly drift" principle this codebase has fixed for repeatedly elsewhere (see `D-007`'s HMAC timing fix, the BullMQ dead-letter queue in Phase 5/7, the approval-timeout TOCTOU-safe atomic UPDATE, the self-review-fallback scheduling-failure alert already in `auditOrchestrator.ts`) — this was simply a gap the same principle hadn't been applied to yet, on the one API call in the whole pipeline (`createPullRequest`) that deliberately swallows its own errors.

**Fix (PR [#60](https://github.com/Thatisshayan/project-sentinel/pull/60))**: `auditOrchestrator.ts` now explicitly checks for `!prUrl` and sends a loud, actionable Telegram alert naming the repo, batch, and pushed branch, so a human can open the PR manually. The underlying task-status transition (`build_check`) is left unchanged, matching the "make the failure visible, don't redesign the recovery path" pattern already used elsewhere in this exact file for 2 other similar gaps (approval-timeout scheduling failure, self-review-fallback scheduling failure).

**Fix (PR [#61](https://github.com/Thatisshayan/project-sentinel/pull/61))**:
- `sprintOrchestrator.ts` — on `!prUrl`, marks the task `failed` (not `done`) and pauses the sprint, reusing the exact same pause-and-alert pattern the `batchResult.status !== 'completed'` branch a few lines below it already uses for any other kind of task failure.
- `debugOrchestrator.ts` — on `!prUrl`, marks the debug attempt `failed` (consumes one of its 5 retries, same as any other kind of fix failure) instead of `fix_pending`, and sends the existing `buildCannotFixMessage` instead of the misleading `buildFixReadyMessage`.

**Verified**: `tsc --noEmit` clean and 548/548 backend tests pass after each fix (2 separate verification runs).

### Review-comment follow-up (2026-07-31, same day) — CodeRabbit + Qodo caught real gaps in the fixes above
- **PR #60**: the new `!prUrl` Telegram alert used `await safeFire(...)`, which rethrows on rejection — a Telegram/network hiccup on that specific alert could abort `processNextBatch()` before it reached the `build_check` task-status updates a few lines below, defeating the fix's own purpose. Changed to `fireAndForget`. Separately, `processPREvent.ts`'s merge/reject `UPDATE audit_tasks` queries only matched by `pr_url`/`pr_number`, so a human manually opening and merging a PR from the branch named in the alert would never actually match the stuck tasks — added a `branch_name` fallback match when both PR-identity fields are null, on both the merge and reject queries, with a regression test.
- **PR #61**: the new `!prUrl` branches in both files replicated the "mark failed, alert" shape but dropped two things the sibling success/failure paths already did — `debugOrchestrator.ts` wasn't persisting `fix_commit_sha`/`fix_branch` (real pointers `cloneAndFix()` had already produced) and wasn't transitioning Notion to `'Broken — Human Required'` when the failure happened on the last allowed attempt; `sprintOrchestrator.ts` wasn't syncing the linked `audit_task` row, leaving it re-executable even though a branch/commit already existed for it. Both fixed to mirror their sibling paths.

---

## Areas reviewed with no findings
- `webhook.ts` — signature verification (HMAC + `timingSafeEqual`, length-checked first), rate limiting, ping-event handling, per-event-type routing. No issues.
- `webhook/processWebhook.ts` — dedup claiming, Notion permanent-vs-retryable error classification, metrics upsert, high-risk security-scan triggering. No issues.
- `webhook/processPREvent.ts` — active-branch clearing (guarded against stale/duplicate webhook deliveries clobbering a newer record), task-status transitions on merge/close, re-audit-after-merge trigger (correctly represents the merge as human-attributed so Rule 1's Sentinel-commit skip doesn't misfire). Later gained a real fix itself (see review-comment follow-up above) — the branch-name fallback match on PR-merge/reject.
- `taskBuilder.ts` — builder-fallback loop (loop-guarded, working-tree reset between attempts), base-branch-drift auto-rebase, aider process spawn/timeout/cleanup. No issues.
- `queueClient.ts` — Redis connection/reconnect handling, BullMQ job-ID colon-sanitization (a previously-fixed real bug, still correctly in place), dead-letter and scheduled-job queues. No issues.
- `buildPoller.ts` — GitHub Actions/Vercel/Railway status polling, SHA-lookup fallback windows, result aggregation. No issues.

## Status
**Complete**, including the review-comment follow-up. PRs #60 and #61 are open with all CodeRabbit/Qodo findings addressed; CI green on both at time of writing. Neither has been merged yet (owner's call on timing/order).
