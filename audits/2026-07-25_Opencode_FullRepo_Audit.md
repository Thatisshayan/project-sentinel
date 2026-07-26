# Audit: Full Repository Read-Only Bug Audit (Opencode, 1 Coordinator + 6 Workers)

**File**: `audits/2026-07-25_Opencode_FullRepo_Audit.md`
**Date**: 2026-07-25
**Agent**: Opencode
**Scope**: Full repository — backend (`backend/src/**`, `backend/test/**`), UI (`ui/**`), CI/CD (`.github/**`), configs/scripts/manifests/deploy
**Method**: Read-only, line-by-line. 1 coordinator (this report) + 6 worker subagents — non-overlapping scopes, no nested subagents. Total 7 agents (within the 8-agent hard cap).
**Status**: COMPLETED

---

## Rule 3 Compliance: Truthfulness

| Claim | Verified? | Evidence |
|---|---|---|
| Used 6 worker subagents, not 40 | ✅ | 6 concurrent `task` invocations (subagent_type: explore) — one per coherent scope |
| No nested subagents spawned | ✅ | Worker outputs contain no further `task` calls |
| Total agents ≤ 8 | ✅ | 6 workers + 1 coordinator = 7 |
| Per-file coverage statements reported by each worker | ✅ | All 6 workers reported `files in scope`, `files fully read to EOF`, `partially verified`, `scope fully covered: yes` |
| Prior fixes verified against current source, not trusted blindly | ✅ | Each worker listed prior-bug verification separately from new findings |
| Read-only: no files modified by audit | ✅ | No `edit`/`write` to source files; only this audit file is written, per R6 |
| Disagreement resolved by inspecting source directly | ✅ | Coordinator re-read `portfolioAnalytics.ts`, `dailyReportWorker.ts`, `slackEvents.ts`, `webhook/processPREvent.ts` to resolve H-1, DM-1, H-2, M-1 |

**One governance tension, surfaced honestly**: this audit was originally performed strictly read-only (no files touched). Writing THIS audit file is the single modification — a documentation-only addition mandated by R6 itself ("Every audit must be saved using the naming convention"). Branch-only workflow followed; no direct commit to `main` (see Rule 9 below).

---

## Rule 5 Compliance: Audit Basis

### Code Inspection
- All workers read every file in scope line-by-line to EOF. Coverage matrix in Section 7.
- Coordinator spot-checked cross-worker disagreements by directly re-reading current source (`portfolioAnalytics.ts:60-99`, `dailyReportWorker.ts:1-128`, `slackEvents.ts:95-186`, `webhook/processPREvent.ts:1-94`).

### Docs Reference
- `REPO_RULES.md` v1.0.0 (2026-07-23), `AGENTS.md`, `REPO_DIRECTIVE.md`, `ConfirmedBugs.md` (the 35-bug history register), `audits/2026-07-25_Hermes_PostAuditRemediation_Audit.md`, `audits/2026-07-23_Hermes_GovernanceBootstrap_Audit.md`, `docs/governance/BRANCH_POLICY.md`, `docs/governance/DEFERRED_WORK.md`, `docs/ARCHITECTURE.md`, `RAILWAY_SETUP.md`, `README.md`, `STATUS.md`, `TODO.md`, `MANUAL.md`.

### Previous Audits
- `2026-07-25_Hermes_PostAuditRemediation_Audit.md` — silent-catch logging fix in `taskBuilder.ts`/`claudeCodeAudit.ts`/`aiderRunner.ts` verified surviving; Dependabot triage context reused.
- `2026-07-23_Hermes_GovernanceBootstrap_Audit.md` — referenced for governance-bootstrap context.
- `ConfirmedBugs.md` — the 35-bug history was used as a verification checklist (every bug listed as "fixed" was checked against current source). Findings H-1, M-6, and DM-1 update or extend that history.

---

## 1. Executive Summary

The repo has had extensive prior bug-audit work (35 bugs documented/claimed-fixed in `ConfirmedBugs.md` across 5 passes ending 2026-07-19). This audit verified the surviving state of every cited prior fix and audited ~15 NEW source files (`slackClient.ts`, `slackEvents.ts`, `slackInteractions.ts`, `viktorWatcher.ts`, `viktorAuthority.ts`, `roundtable.ts`, `externalAgentRegistry.ts`, `retry.ts`, `commandRegistry.ts`, `agents-proxy/route.ts`, `agent-room-proxy/route.ts`, `settings/route.ts`, etc.) plus all configs that post-date the last audit.

**Headline result**: a new, systemic High-severity bug affects every scheduled cron job in the system. It is the same failure class as prior bug #17 (`SPRINT_CONTINUE_JOB` jobId clash) but missed — every BullMQ cron in `dailyReportWorker.ts` / `sprintWorker.ts` pairs `repeat: {...}` with a constant `jobId`, which BullMQ dedupes indefinitely. **The entire scheduled-job surface effectively dies after the first fire per process boot.**

Beyond that:
- All 35 previously-cited prior fixes for the in-scope files **do survive** EXCEPT one (`ConfirmedBugs.md` bug #11, see DM-1): the current source re-encodes the original buggy behavior with a comment justifying it, contradicting the audit doc's "fixed" claim — a real doc/code mismatch worth annotating.
- 5 new High/Medium findings across runtime, integrations, and supply-chain CI.
- Several Low-severity latent issues (trust boundaries, in-memory state across restarts, doc-staleness, lint zero-coverage).
- 5 actively misleading tests (false-pass masks) in the suite worth fixing in a follow-up.

---

## 2. Coverage Summary

| Worker | Scope | Files in scope | Fully read | Partially verified | Fully covered |
|---|---|---|---|---|---|
| 1 | Backend runtime core (orchestrators/queue/db/workers/utils) | 38 | 38 | 0 | ✅ |
| 2 | Backend integrations/services (Slack/Viktor/agents/Telegram/Notion) | 35 | 35 | 0 | ✅ |
| 3 | Backend HTTP/webhook/api/security/db/reports | 49 | 49 | 0 | ✅ |
| 4 | UI business logic + UI proxy routes | 50 | 50 | 0 | ✅ |
| 5 | Backend test suite | 51 | 51 | 0 | ✅ |
| 6 | Config/CI/deploy/scripts/manifests | ~50 | All but lockfiles + large handoff docs | 2 lockfiles (policy); 4 historical handoff docs (R15, spot-checked); `npm audit` for `ui/` OOM'd in this Windows env | ✅ (with noted caveats) |

**Total agents used**: 6 workers + 1 coordinator = **7** (within the 8-agent hard cap). No nested subagents spawned.

---

## 3. Confirmed Findings by Severity

### 🔴 CRITICAL
None — no live, currently-exploitable critical defect found. (Two `High` findings border on Critical but each has a deployment-condition gate; see confidence notes.)

### 🟠 HIGH

#### H-1 — `backend/src/workers/dailyReportWorker.ts:49-52` (and `sprintWorker.ts:21-24`) — BullMQ `repeat` + constant `jobId` makes every cron fire at most ONCE per process boot
**Severity: High | Confidence: High**

- **Why:** Every `queue.add(name, data, { repeat: { pattern }, jobId: '...-cron' })` call pairs a cron-repeat with a constant jobId. Per BullMQ's documented semantics, `add()` with a `jobId` that already exists (even completed) returns the existing job instead of producing a new delayed/repeated instance. After the first fire completes and is retained, every subsequent `add()` for that jobId is a silent no-op. The very same `autoApprover.ts:25-31` comment in the same codebase warns about this exact trap.
- **File/line:** `dailyReportWorker.ts:49-52, 54-57, 59-62, 64-67, 69-72, 74-77, 79-82, 84-87, 89-92, 94-97, 99-102, 104-107, 109-112, 114-117, 119-122, 124-127` (all 18 cron-adds); `sprintWorker.ts:21-24` for the sprint-proposal cron. `weekly-audit` at line 94-97 is the highest-impact one — it never runs the full-portfolio sweep after the first execution per boot.
- **Impact:** 18 scheduled jobs die after first fire per process restart. Given Railway redeploys on this system's own merged PRs (per `auditOrchestrator.ts:626`, `sprintOrchestrator.ts:166-169`, prior bugs #6/#12/#13 reasoning), daily reports, weekly reports, weekly audit sweeps, monthly security reports, morning briefings, agent standups, leaderboards, repo discovery, GitHub metrics sync, pattern detection, CEO report, agent-room broadcasts — all silently stop firing any time the process restarts within their window. None alert when they fail to schedule.
- **Verify:** Boot the worker; wait until 09:00 fires once; observe no further jobs are created on subsequent days without a restart. Or check Redis after a fire — the completed job remains keyed by its `jobId`, and `queue.getJob('daily-report-cron')` returns the completed instance.
- **Correct fix direction (NOT applied):** Omit `jobId` for repeat-pattern cron jobs (BullMQ dedupes internally via the cron key), or use `queue.upsertJobScheduler(...)` (BullMQ ≥ 1.20).
- **Related:** Same failure class as `ConfirmedBugs.md` bug #17 (the `SPRINT_CONTINUE_JOB` unique jobId fix). This one slipped through because that fix only touched the sprint-continue path. The `github-metrics-sync-repeat` (line 109-112) and `repo-discovery-repeat` (line 114-117) `repeat: { every: ... }` constants exhibit the same defect — they fire at most once every process lifetime.

#### H-2 — `backend/src/slackEvents.ts:163-185` — no `event.subtype` / `event.bot_id` filter on `message` events creates reply-count inflation and an echo loop on Sentinel's own posted messages
**Severity: High (deployment-gated) | Confidence: Medium-High**

- **Why:** `handleSlackEvent` handles every `event.type === 'message'` without inspecting `event.subtype` (Slack sets `subtype: 'bot_message'` for bot-authored messages) or filtering `event.bot_id` / `event.user` matching the app's own bot id. Slack's Events API re-delivers the app's own `chat.postMessage` outputs as `message` events. The branch dispatches into `handleViktorMessage` (line 164), `recordAgentReply` (line 176), and `recordRoundtableReply` (line 182) — all keyed on `thread_ts`. Sentinel's own synthesis post at `agents/roundtable.ts:281` is sent with `thread_ts = session.thread_ts`, so its own post can feed back as a "reply", inflate the responded count (`roundtable.ts:189`), and trigger a SECOND `runRoundtableSynthesis` call.
- **File/line:** `slackEvents.ts:163, 175, 182`; matched impact in `agents/roundtable.ts:176-194` and `agents/externalAgentRegistry.ts:186-201`.
- **Impact:** (a) Double-synthesis posted to Slack + double LLM spend when the synthesis echo trips the count threshold. (b) Every external-agent top-level reply to a Sentinel post never gets correlated as a "reply" (no `thread_ts`), so timeouts/Audit "agent never replied" dispositions become false negatives. (c) `handleViktorMessage` is wasted cycles on every Sentinel self-post.
- **Verify:** Configure `SLACK_BOT_TOKEN`; send a top-level `chat.postMessage` from this app into a subscribed channel; observe that a `message` event is delivered back to `/webhook/slack-events` with no `subtype` filter; for the roundtable case verify a second synthesis is posted when the bot's own first synthesis echoes.
- **Deployment gate:** Currently `SLACK_BOT_TOKEN` is unset per `slackClient.ts:193-197`'s safe-by-construction no-op pattern, so the bug is dormant today. Phase 1-7 effort presumes Slack WILL be configured, at which point this activates immediately. Reported at High because it is a guaranteed regression surface the moment the integration lights up.

#### H-3 — `.github/workflows/ci.yml:61` — third-party GitHub Action pinned to mutable `@main` branch (supply-chain / non-reproducible CI)
**Severity: High | Confidence: High**

- **Why:** `uses: dependency-check/Dependency-Check_Action@main`. Pinning a third-party action to its mutable `main` branch means any commit pushed upstream — including a malicious or compromised-maintainer commit — runs in CI on the next weekly schedule with the runner's `GITHUB_TOKEN`. It is the only action in the file pinned to `@main`; all others use `@v7`/`@v3` tags.
- **Impact:** Weekly OWASP `dependency-check` scan runs untrusted action code with repo/PR token privileges from a scheduled run that nobody watches. Dependabot does NOT cover mutable-branch refs (only version-tag refs), so this stays unreviewed indefinitely.
- **Verify:** `rg '@main' .github/workflows/`.
- **Related:** REPO_RULES R34 (Dependabot covers `github-actions`, but it bumps tag refs, not `@main`).

### 🟡 MEDIUM

#### M-1 — `backend/src/webhook/processPREvent.ts:48,77` — `OR` clause in `WHERE pr_url = $2 OR pr_number = $3` can mark unrelated tasks done
**Severity: Medium | Confidence: Medium**

- **Why:** Both the merged-PR path (line 44-51) and the rejected-PR path (line 72-80) match audit tasks via `AND (pr_url = $2 OR pr_number = $3)`. Scenario: task A has `pr_url='...pull/99'` + `pr_number=99`; task B (stale race) has `pr_number=99` + `pr_url=NULL`. When the webhook fires for PR #99, BOTH tasks match the OR. Eligibility is narrowed by `status IN ('build_check','in_progress')` but the OR shape is wrong — should be `AND` between the two identifiers, or just `pr_url = $2` alone.
- **Verify:** Insert two audit_tasks rows for the same repo with same `pr_number` but only one row's `pr_url` matching; trigger the closed-webhook; observe both rows flipped to `done`/`queued`.

#### M-2 — `backend/src/agents/roundtable.ts:152-195` + `agents/roundtable.ts:255-258` — synthesis trigger can run concurrently with itself (no atomic claim on `status='pending'`)
**Severity: Medium | Confidence: Medium**

- **Why:** `recordRoundtableReply` atomically appends to `agents_responded` (good), but the `responded.length >= agentsAsked.length` gate at line 189 then calls `runRoundtableSynthesis` OUTSIDE the transaction. The idempotency guard at lines 255-258 only stops already-`'complete'` sessions. A scheduled timeout job (`ROUNDTABLE_TIMEOUT_JOB` in `scheduledJobsWorker.ts`) and the final reply can race; both read `status='pending'` before either writes `status='complete'`, both call the LLM and `sendSlackMessage` the synthesis twice.
- **Verify:** Confirm `runRoundtableSynthesis` does not wrap `SELECT status ... FOR UPDATE` / atomic `UPDATE ... WHERE status='pending' RETURNING ...`. It does neither.

#### M-3 — `backend/src/deduplication.ts:1-58` — in-memory `Map` dedup is wiped on every process restart (webhook replay protection bypassed)
**Severity: Medium | Confidence: High**

- **Why:** Module-level `new Map<string,{ts:number}>()` keyed on `${repoName}:${commitSha}`, never persisted to Redis or DB. Process restart (which this system triggers on its own merged PRs) wipes the map. Combined with `processWebhook.ts:44-57`'s claim-then-release (which only persists a claim in-memory), a GitHub webhook redelivery after a restart passes `isAlreadyProcessed` as false within the 10-minute TTL window, re-claims in the new process, and re-runs the entire Notion update → changelog → Telegram → security scan → build-check chain. There is NO database-level dedup.
- **File/line:** `deduplication.ts:1-58` (the `store` Map); `processWebhook.ts:24-26, 44-57` (claim/release on in-memory store).
- **Impact:** Doubled Notion writes, doubled changelog entries, doubled Telegram messages, doubled security scans, doubled build enqueue after any restart within 10 minutes of a webhook delivery. Bug #28 fixed the within-process race window but not the across-restart gap.
- **Verify:** Push a commit; wait < 10 min; trigger a Railway redeploy; re-deliver the same webhook from GitHub's Redeliver UI.

#### M-4 — `backend/src/api.ts:344-361` — `/system/set-builder` interpolates unescaped `repoName` into a LIKE wildcard pattern
**Severity: Medium | Confidence: Medium**

- **Why:** `query('... LIKE $2 ...', [builder, `%/${repoName}])`. `repoName` is interpolated into `%/${repoName}`, so `%` and `_` are LIKE wildcards. A `repoName` of `_` would match `%/X` for any single char across MULTIPLE unintended repos; `%` would match anything. `set-builder` skips the `^[a-zA-Z0-9][a-zA-Z0-9_.-]*$` regex validation that the sibling `/repo/:name` route enforces. The auth gate (`x-sentinel-key` at api.ts:32-40) protects from external callers, but an authenticated UI user can fat-finger wildcards or maliciously cross-update tasks across repos.
- **Verify:** POST `/api/system/set-builder` with body `{repoName:"_%", builder:"aider"}` (if `aider` is a valid key); confirm rows across unintended repos match `LIKE %/_%`.

#### M-5 — `backend/src/api.ts:227` — `handleCommand(text, null, null, fromName, null)` passes `null` for `chatId: number` (declared non-null)
**Severity: Medium | Confidence: High**

- **Why:** `telegramCommands.ts:54` declares `chatId: number` (no `| null`). api.ts:227 calls with literal `null`. Dispatch propagates `String(null)` → `"null"` into downstream handlers (`/start`, `/menu`, `/help` at telegramCommands.ts:107-112, and `handleSprintCmd`/`handleReportsCmd`/`handleAgentsCmd`/`handleRepoOpsCmd` at lines 121-123). Telegram rejects `chat_id="null"`, so interactive menus triggered from the dashboard's `/api/command` endpoint silently never display.
- **Verify:** POST `/api/command` with body `{text:"/start"}`; confirm no Telegram message is sent.

#### M-6 — `backend/src/workers/dailyReportWorker.ts:180` — `weekly-audit` hardcodes `branchName: 'main'` (same class as `ConfirmedBugs.md` bug #31, missed here)
**Severity: Medium | Confidence: High**

- **Why:** `triggerAudit({ ..., branchName: 'main', ... })`. Prior bug #31 fixed this for `/repo/:name/audit` and `/system/audit-all` in `api.ts` by adding `getDefaultBranch()`, but the `weekly-audit` cron in `dailyReportWorker.ts:180` was missed. Any tracked repo whose default branch is not `main` (e.g. `let-it-rain` from prior bug #31) silently fails the weekly audit sweep with `fatal: Remote branch main not found in upstream origin`.
- **Verify:** Identify a tracked repo with non-`main` default branch; wait for the `weekly-audit` cron (or invoke the worker manually); observe the git clone failure in logs for that repo.
- **Related:** `repoDiscovery.getDefaultBranch()` (added by bug #31 fix). Same fix should be applied here.

#### M-7 — `.github/workflows/gate.yml` + `scripts/verify.sh` (and `verify.ps1`) — gate advertises `build/test` but actually skips them for this monorepo
**Severity: Medium | Confidence: High**

- **Why:** gate.yml runs `bash scripts/verify.sh`. `verify.sh:113-117` detects the package manager by checking for a ROOT lockfile (`pnpm-lock.yaml` / `yarn.lock` / `package-lock.json`); this repo has NONE at root (only `backend/` and `ui/` subdirs). So `PM` stays empty and the script prints `::notice title=build::no build system detected; docs/static repo — skipping build/test`. The actual build/test coverage lives in `ci.yml`'s separate `backend`/`ui` jobs (a different workflow), not in `gate`.
- **Impact:** The required-check named `gate` is wired into branch protection (BRANCH_POLICY.md:16-22). If `ci.yml` were ever disabled or mis-tuned, a PR could merge through `gate` green without build or test ever running. R30 requires build AND test to merge; today they do pass via `ci.yml`, but the named required check doesn't verify them. Naming is misleading for an auditor.
- **Verify:** Run `bash scripts/verify.sh` locally; observe the printed `::notice title=build::no build system detected...` and the absence of any actual `npm ci`/build invocation in the `== build / test ==` section.

#### M-8 — `RAILWAY_SETUP.md:26` — wrong start command (`node src/index.js`) vs runtime (`node dist/index.js`)
**Severity: Medium | Confidence: High (doc/code mismatch affecting operations)**

- **Why:** `RAILWAY_SETUP.md:26` says "The app starts with: `node src/index.js`". Actual runtime: `backend/railway.toml:6` `startCommand = "node dist/index.js"`; `backend/Dockerfile:55` `CMD ["node", "dist/index.js"]`; `package.json` `build` runs `tsc → dist/`. `src/index.ts` is TypeScript source, `node src/index.js` would fail (no such file).
- **Impact:** A fresh operator following RAILWAY_SETUP literally fails to start the backend; violates R23 ("README + .env.example must let a fresh agent stand the repo up with no hidden manual steps"). The Phase-2 TypeScript migration (2026-07-17) shipped without updating this doc — R2 violation.

#### M-9 — Test defects (5 actively misleading false-pass tests)
**Severity: Medium (cumulative) | Confidence: High** — Detail in the dedicated "Test Defects" section below.

### 🟢 LOW (and Informational)

- **L-1 — `backend/src/queueClient.ts`** — `connection.on('close')`/`on('end')` set `connection = null` but cached `Queue` singletons still hold the dead connection. Either remove the null-reset (let BullMQ auto-reconnect) or invalidate the cached queues. Severity Low | Confidence Medium.

- **L-2 — `backend/src/conflictDetector.ts:11,30`** — in-memory `pendingConflicts` Map + bare `setTimeout` cleanup is not restart-safe. Same persistence-vs-setTimeout pattern bugs #6/#10/#12/#13 explicitly fixed elsewhere; conflict-resolution was missed. After a restart during a pending conflict, the human's resolve callback silently no-ops. Severity Low | Confidence High.

- **L-3 — `backend/src/auditOrchestrator.ts:245-262`** — `writeTasksToNotion` failure does not stop the cycle from advancing to `'awaiting_approval'`; `safeCount`/`totalCount` taken from AI's intent, not from `writeResult.failed`/`writeResult.skipped`. User approves "Execute N safe tasks" batch but `getNextBatch` finds zero queued → cycle completes silently with no work run. Severity Low | Confidence Medium.

- **L-4 — `backend/src/parallelExecutor.ts:166-191`** — results array is in completion order, not submission order. Consumers indexing `results[i]` for `tasks[i]` get wrong pairing. Currently masked by callers that re-key on `task` or only count. Severity Low | Confidence Medium.

- **L-5 — `backend/src/correlationEngine.ts:24-33`** — `enqueueScheduledJob` return value (null when Redis unconfigured) is not inspected; log falsely claims "PR impact tracking started". Same swallow pattern bugs #6/#27 warned about; correlationEngine did not adopt the good pattern that `auditOrchestrator.ts:636-648` uses. Severity Low | Confidence Medium.

- **L-6 — `backend/src/sprintOrchestrator.ts:319-324`** — `resumeSprint` only clears ONE `failed` task with `find()`; multi-failure sprints strand additional `failed` rows permanently. Replace `find()` with `filter(...).forEach(...)`. Severity Low | Confidence Medium.

- **L-7 — `backend/src/utils/timingSafeCompare.ts:13-25`** — unequal-length early-return branch is dead defensive code (both branches do identical HMAC work). Not a functional or side-channel bug. Severity Low (informational) | Confidence High.

- **L-8 — `backend/src/api.ts:196-210`** — `/agents/:id/toggle` flips `working`/`failed` agents to `idle` (status-lifecycle bug). An authenticated admin UI "toggle" can clobber a working agent losing its in-flight state without canceling the work. Severity Low | Confidence Medium.

- **L-9 — `backend/src/api.ts:117-157`** — repo `:name` regex `^[a-zA-Z0-9][a-zA-Z0-9_.-]*$` rejects repos with leading `_`/`.`/`-`; inconsistent with the unvalidated `/system/set-builder` and `/repo/:name/audit` routes. GitHub allows those names; niche. Severity Low | Confidence Medium.

- **L-10 — `backend/src/securityScanner.ts:65-68` (and `securityPatcher.ts:72-74, 96-97`)** — `GITHUB_TOKEN` embedded in the git clone `https://...@github.com/...` URL leaks into logs/Sentry on clone failure. `simple-git` echoes input url in the rejection error string; Sentry would forward that. Severity Low | Confidence High.

- **L-11 — `backend/src/agentDb.ts:142-171`** (`acquireFileLocks`) — an expired-but-present lock returns `lockedBy: 'unknown'` instead of opportunistic-stealing the free lock. Severity Low | Confidence Low.

- **L-12 — `backend/src/telegramClient.ts:78-80`** — `sendTelegramMessage` fires Slack fan-out with `repoName` only, but most callsites pass `repoName: null`, so Slack never receives most agent-room chatter. Acknowledged in `slackEvents.ts:22-28` as a known limitation. Operationally invisible to an operator enabling Slack. Severity Low | Confidence High.

- **L-13 — `backend/src/telegramAI.ts:337-372`** — answer-routing fallback `sendAsAgent(...).catch(async () => { await executeAction(parsed, topicId); })` is dead-redundant fallback for `parsed.action === 'answer'`. Reviewer-only, no functional bug. Severity Informational.

- **L-14 — `backend/src/selfAuditDb.ts:172-179`** — `tryClaimSelfHealerAlert` cooldown SQL `($1 || ' milliseconds')::INTERVAL` is fragile if `cooldownMs` is ever passed as a non-integer JS Number (numeric→text operator resolution fails on some pg versions). Latent footgun; works for the current integer constant. Severity Low | Confidence Medium.

- **L-15 — `backend/src/workers/buildPollWorker.ts:31-32, 61`** — "Build still pending after 10 minutes." string hardcoded; brittle if either `POLL_INTERVAL_MS` or `MAX_POLL_ATTEMPTS` is tuned independently. Severity Low | Confidence High (low impact).

- **L-16 — `backend/src/auditDb.ts:162-171, 240-249`, `securityDb.ts:100-109`, `sprintDb.ts:109, 152`** — dynamic column-from-`Object.keys(updates)` UPSERT patterns lack the explicit allowlist that `dbClient.ts:183` already established. Latent SQL injection shape. All known call sites pass literal keys today; the next caller passing a user-tainted key becomes an injection point. The codebase has the correct pattern in `dbClient.updateDebugAttempt` and `settingsDb.updateSettings` — the others should adopt it. Severity Low | Confidence Medium.

- **L-17 — `ui/next.config.mjs:1-4`** — empty Next config, no security/response headers (no CSP, no `X-Frame-Options`, no HSTS, no `X-Content-Type-Options`). Dashboard can be framed — clickjacking of "Pause All" / "Approve" / "Patch All Safe" action buttons. Severity Low (hardening gap) | Confidence High.

- **L-18 — `ui/app/api/action/route.ts:12-21` and `ui/app/api/settings/route.ts:12-18`** — shared "unknown" rate-limit bucket for clients without `x-forwarded-for`; plus an unused `rateLimitMiddleware` import (dead code). Single client exhausts the 60-rpm budget shared by every other XFF-less client. Severity Low | Confidence High.

- **L-19 — `ui/app/agent-room/page.tsx:93`** — hardcoded operator identity `fromName: "Shayan"` shipped to every browser client. Leaks founder name in the JS bundle anywhere the dashboard is viewed. Compare to the neutral `fromName: "Dashboard"` already used in `sidebar.tsx:220` and `sprint-view.tsx:60`. Severity Low | Confidence High.

- **L-20 — `ui/app/agent-room/page.tsx:52-77`** — unbounded polling with no error/backoff and three extra `setTimeout` calls per send; `lastId` written but never read (dead state). Not security; resource waste + abandoned optimization. Severity Low | Confidence High.

- **L-21 — `webhook-test.json` (root)** — committed test fixture appears unused by any `backend/src/` or `backend/test/` file per quick grep. Recommend confirming it's still used, or removing (file deletion requires Shayan's approval per R14). Not a security leak — fixture uses `your-org/tapcash`, `test@example.com`, fake commit SHA `deadbeef…`. Severity Low | Confidence Medium.

- **L-22 — `docs/slack-app-manifest.json:28, 36`** — public-facing Railway backend webhook URL committed in repo. URL is discoverable; signing-secret validation protects against unauthorised payloads, so this is "endpoint existence disclosure" not exploitable. Severity Low (info disclosure) | Confidence Medium.

- **L-23 — `backend/Dockerfile:24`** — `npm ci --only=production` is the legacy flag (deprecated, npm v9 removed it); works on Node 20/npm 10 with a deprecation warning but will break on newer npm. Also `npm install -g @anthropic-ai/claude-code` (line 27) is unpinned, hurting reproducibility. Severity Low | Confidence High.

- **L-24 — `backend/.eslintrc.json:24`** — `ignorePatterns: ["**/*.ts"]` lints code but skips 100% of first-party TypeScript source. `npm run lint` exits 0 with nothing checked. Already tracked as D-001; restating current-state reality. Severity Low | Confidence High.

- **L-25 — `ui/Dockerfile`** — single-stage, no `--omit=dev`, no `ui/.dockerignore`, no `USER` directive; `docker-compose.yml:64` maps `3001:3000` without a UI healthcheck; `ui/railway.toml` uses `builder = "NIXPACKS"` so Railway ignores the Dockerfile for production deploy. Railway production build path (Nixpacks) is exercised in CI by neither `ci.yml` ui job nor the `docker-build` matrix — so a Nixpacks-specific breakage ships green-to-CI but breaks live Railway deploy. Already partially tracked in DEFERRED_WORK D-010 #37. Severity Low | Confidence High.

- **L-26 — `.github/workflows/test-integration.yml:4-9`** — `workflow_dispatch` default branch is `feat/phase6-arch-refactor`, not `main`. Manual-trigger default footgun; brittle branch-name drift. Severity Low | Confidence High.

- **L-27 — `docs/ARCHITECTURE.md:30-45`** — references `.js` files that no longer exist (`index.js`, `webhook.js`, `auditOrchestrator.js`, etc.); Phase-2 TS migration renamed them all to `.ts`. Already tracked as `T1` in `REPO_DIRECTIVE.md` but the directive task has not landed → doc still ships wrong today. Severity Low (doc-freshness R1/R2) | Confidence High.

- **L-28 — `backend/src/webhook/processCodeRabbitEvent.ts:135`** — task_number hardcoded `i + 1` (sibling live path uses `getNextTaskNumberForCycle`); inconsistency is a maintenance landmine though currently safe due to early `createAuditCycle` conflict-exit. Severity Low | Confidence Medium.

- **L-29 — `ui/app/api/action/route.ts:63, 75`** — UI action-proxy allowlist has 2 dead entries: `/^\/api\/portfolio$/` (a GET, but the proxy is POST-only) and `/^\/api\/settings\/update$/` (the UI uses the dedicated `/api/settings` POST proxy). Unreachable entries clutter the policy. Severity Informational | Confidence High.

### Doc/Code Mismatch (escalated separately for transparency)

#### DM-1 — `ConfirmedBugs.md` bug #11 claim ("`fix_pending → failed` is a bug, was fixed") contradicts current source
The current `portfolioAnalytics.ts:79-82` deliberately treats `fix_pending` as `failed` WITH a justifying code comment ("Covers 'fix_pending' too: a fix PR being open isn't the same as merged — the repo's main branch is still red until the merge webhook confirms it."). Either the prior fix was later reverted in favor of the original behavior, or the prior "fixed" claim in `ConfirmedBugs.md` was overstated. The current code is internally consistent and defensible; the audit doc is the stale side. Per R15 (mark superseded historical docs as historical, don't let them silently compete with current truth), recommend annotating `ConfirmedBugs.md` entry 11 as "behavior is intentional per portfolioAnalytics.ts:80-82 comment — supersede this entry". Severity: Informational | Confidence: High.

---

## 4. Test Defects (from Worker 5)

The backend test suite provides a meaningful regression net, but has 5 actively misleading tests (false-pass masks) plus a set of "missing regression coverage" gaps.

- **TD-1 — `backend/test/timingSafeCompare.test.ts:35-45`** — header claims the impl no longer has the `if (a.length !== b.length)` early-return; the impl at `utils/timingSafeCompare.ts:13-19` STILL has exactly that branch. Test passes trivially for unequal-length strings; readers trust a side-channel closure that does not exist. Severity Medium | Confidence High.

- **TD-2 — `backend/test/notionClient.test.js:1-32`** — Named after `notionClient` but only requires `extractPayload`. Tests a hand-rolled local `findMatch` using `.toLowerCase()` only; real `findNotionProject` (`notionClient.ts:44-65`) uses `.toLowerCase().replace(/[-_]/g,'')` plus `Repo Name`/`Name`/`Project`/`Title` property fallbacks. Local stub shadowing — no real coverage. Severity Medium | Confidence High.

- **TD-3 — `backend/test/sentinelBrain.test.js:56-64`** — "brain_decisions INSERT uses JSON.stringify for context" asserts `expect(insertCalls.length).toBeGreaterThanOrEqual(0)`. `.length` is always `>=0`; assertion cannot fail under any input. Comment even admits "or zero if AI failed before save — both valid". Severity Medium | Confidence High.

- **TD-4 — `backend/test/e2e_mint.test.js:530-550`** — Audit-failure test mocks `getLastCompletedAudit.mockResolvedValue({ completed_at: oldAudit })` (wrong field — prod reads `created_at`). `new Date(undefined).getTime() === NaN`; `NaN < cooldownHours` is `false`; cooldown falls through. Test passes only because field-name confusion silently bypasses cooldown entirely — not for the asserted reason ("25h ago, cooldown elapsed"). Severity Medium | Confidence High.

- **TD-5 — `backend/test/webhook.test.js:266-277`** — Notion permanent-error classifier test covers only 1 of 3 codes (`unauthorized`) the production `PERMANENT_NOTION_ERROR_CODES` set defines. `restricted_resource` and `object_not_found` have no coverage. A future `.code` translation/drop would silently pass CI. Severity Low | Confidence High.

**Missing regression coverage observed (informational):**
- **bug #11 velocityTracker `fix_pending`** — no test pins down current behavior either way.
- **bug #17 SPRINT_CONTINUE_JOB unique `jobId`** — `scheduledJobsWorker.test.ts:112-117` only delegates a single SPRINT_CONTINUE_JOB; never asserts distinct jobIds across multiple continuations.
- **bug #21 api.ts `?limit=` negative/NaN fallback** — `api.test.js` has zero tests for `/api/agent-room/messages`; no `?limit=-5`, `?limit=foo`, `?limit=0`, `?limit=100000` cases.
- **api.test.js overall coverage gap** — only `GET /api/portfolio` and auth middleware tested; `/api/agent-room/messages`, `/api/repo/:name`, `/api/sprints` have no tests.
- **Mild cross-test leakage** — `safeFire.test.ts:57-79` registers a dead-letter enqueuer but doesn't reset between `it()` blocks (does not cause fail today; risky for future tests).

---

## 5. Follow-up / Uncertain Findings

- **U-1 — `backend/src/selfScaler.ts:8-24`** — module-level `BATCH_SIZE_OVERRIDE`/`DAILY_LIMIT_OVERRIDE` mutated by `runSelfScaler` (cron-driven BullMQ worker) and read by `auditOrchestrator.ts:38-39`. If multiple Railway replicas run, each has its own override state AND two simul `runSelfScaler` invocations can last-writer-wins the `persistOverrides()` row. Cannot confirm multi-replica deployment from source alone.
- **U-2 — `npm ls` shows multiple invalid-version mismatches locally for both `backend/` and `ui/`** (e.g. `@anthropic-ai/sdk@0.104.1` vs `^0.115.0`). Almost certainly stale local `node_modules` (CI uses `npm ci` from a consistent lockfile). Lockfile itself not line-audited per policy. Recommending a fresh `npm ci` locally to clear confusion.
- **U-3 — `npm audit --omit=dev` for `ui/` crashed this Windows session with V8 OOM** ("Zone Allocation failed - process out of memory"). Could not obtain a clean ui-CVE audit pass via this tool. The CI ci.yml `ui` job does not run `npm audit`, so today there is **no CI gate for ui CVEs at all** (the backend `npm audit --audit-level=high` gate covers only the backend). Could be raised to a finding if R34 is interpreted to require ui-side audit; stated here as uncertain.
- **U-4 — README.md `53 suites / 431+ tests`** vs DEFERRED_WORK.md "197/197 tests" cannot be reconciled without running jest (excluded here). Likely count granularity (`it()` count vs jest summary); flagging as doc-consistency uncertainty.
- **U-5 — Live GitHub branch-protection settings** for `main` cannot be verified from the repo alone. The repo's *documentation* of them (BRANCH_POLICY.md, REPO_RULES Appendix A) is internally consistent and matches the gate wiring.

---

## 6. Residual Risk

- **The H-1 BullMQ cron defect is strongly suspected to be a live, High-impact bug**, but BullMQ semantics around `repeat`+`jobId` should ideally be confirmed by a runtime test against a real Redis before claiming as Critical. The same codebase's own comments (autoApprover.ts:25-31) and bug #17's documented resolution support the interpretation. Confidence in interpretation: High; confidence in actual production behavior rests on BullMQ's documented behavior rather than something exercised in a test.
- **The H-2 Slack echo loop is dormant today** (SLACK_BOT_TOKEN unset per `slackClient.ts:193-197`), but WILL activate the moment Slack is turned on. Reported at High because the entire Phase 1-7 effort presumes Slack comes online.
- **The DM-1 bug #11 doc/code mismatch** means either the prior audit overstated its fix or a later commit reverted it; either way, the documented bug history is currently unreliable on this point. Recommend annotating `ConfirmedBugs.md` entry 11 per R15.
- **No real secrets observed in any committed file** (per Worker 6). `.env` files (`backend/.env`, `ui/.env.local`) are gitignored and not tracked; the `ui/.env.local` only has empty placeholders. Informational, not residual risk.
- **Lockfile line-audit was policy-skipped**; multiple local `npm ls` mismatches warrant a fresh `npm ci` before any release-confidence claim.

---

## 7. What Each Worker Covered

| Worker | Scope | Files | Verdict |
|---|---|---|---|
| 1 | Backend runtime core: orchestrators/queue/db/workers/utils/retry/safeFire/taskBuilder/aider/claudeCode/prCreator/buildPoller/parallelExecutor/patternDetector/risk/roi/perf/velocity/crossRepoCoord/capacityManager/conflictDetector/depScanner/owaspChecker | 38 / 38 fully read | Verified survival of prior bugs #3,#4,#6,#10,#11,#12,#13,#17,#26,#27,#29; found H-1, L-1 through L-6 (+ L-14) |
| 2 | Integrations: Slack(3), agents(3), Viktor/roundtable, Telegram(4), Notion(2), GitHub metrics, provider health, costpilot, costTracker, conversation, promptOptimizer, settings, commandRegistry, sentinelBrain, commands(4) | 35 / 35 fully read | Verified bugs #1,#14,#15,#19 survive; found H-2, M-2, L-8 (agentDb lock), L-12 (Telegram→Slack dormant fan-out), L-13 (dead telegramAI fallback) |
| 3 | HTTP/webhook/api/index/health/commands/repoOps/security path (4 files)/repoOnboarder/repoDiscovery/repoResolver/repoLock/auditDb/auditTaskWriter/sprintDb/sprintPlanner/sentinelBrain/reports(5)/notionDashboard/metricsFetcher/integrationsStatus/business(2)/portfolio(2)/capacityManager/aiOutputValidator/priorityEngine/extractPayload/errors(5)/types(2) | 49 / 49 fully read | Verified prior bugs #2,#5,#7,#8,#9,#16,#20,#21,#22,#23,#24,#28,#31,#34 survive; found M-1 (processPREvent OR), M-4 (set-builder LIKE), M-5 (chatId null), M-6 (weekly-audit hardcoded main), L-8 (toggle lifecycle), L-9 (regex strict), L-10 (token leak), L-16 (column-from-keys), L-28 (CodeRabbit numbering) |
| 4 | UI app routes (5) + lib (7) + app pages (8) + sentinel components (11) + shadcn primitives (14) + UI configs | 50 / 50 fully read | Verified bugs #16,#20 survive; confirmed no XSS (no `dangerouslySetInnerHTML`), proxies never read secret from request, action-proxy allowlist matches all 10 `callAction` call sites. Found L-17 (no security headers), L-18 (rate-limit dedup + dead import), L-19 (founder name in bundle), L-20 (polling waste), L-29 (dead allowlist entries) |
| 5 | Every `backend/test/*.{ts,js}` (51 files) | 51 / 51 fully read | Found TD-1..TD-5 active false-pass tests; documented 4 "missing regression coverage" gaps (bugs #11,#17,#21, api coverage) + several minor cross-test/state-mutation leaks |
| 6 | CI/CD (.github/workflows, dependabot, dependency-check-suppressions), scripts (verify.sh/ps1), backend/{Dockerfile, railway.toml, package.json, tsconfig, jest, eslint, prettier, .env.example}, ui/{Dockerfile, railway.toml, package.json, tsconfig, eslint, .env.example, .env.local}, root {.gitignore, docker-compose, README, CONTRIBUTING, SECURITY, LICENSE, REPO_RULES, REPO_DIRECTIVE, TODO, STATUS, MANUAL, RAILWAY_SETUP, webhook-test.json}, docs/{README, QUICKSTART, ARCHITECTURE, slack-app-manifest, _baseline}, docs/governance/{BRANCH_POLICY, DEFERRED_WORK}, audits dir | all policy-excepted lockfiles spot-verified; all CI/CD files read in full; all configs read in full; large handoff docs skimmed (R15 historical) | Found H-3 (action @main), M-7 (gate skips build/test), M-8 (Railway setup wrong cmd), L-21 (webhook-test.json unused), L-22 (Slack manifest URL), L-23..L-26 (Dockerfile/eslint/UI Dockerfile/test-integration); confirmed no real secrets in committed files |

---

## 8. Files or Sections Not Fully Verified

- **`backend/package-lock.json` and `ui/package-lock.json`** — skipped per policy (lockfiles are not line-audited; verified via `npm ls` / `npm audit` instead). Both show local `node_modules` version mismatches but CI uses `npm ci` from a consistent lockfile. Confidence the lockfile is fine: High; confidence local install is stale: High.
- **`npm audit --omit=dev` for `ui/`** crashed with V8 OOM in this Windows env. **No CI gate for ui CVEs** today. Recommend running it offline/larger-mem.
- **Five large historical handoff docs** (`session-sentinel-phase1-build.md` 155KB, `14.07.2026CurrentStateofRepo.md` 43KB, `PROJECT_SENTINEL_CLOSED_LOOP_MASTER_HANDOFF.md` 23KB, `2026-07-22-slack-agent-roster-plan.md` 104KB, `ConfirmedBugs.md` 40KB, `2026-07-16-DeepCodebaseAudit.md` 19KB, plus `PHASE2_*.md`) — governed by R15 as historical; spot-checked via grep for actionable doc/code mismatches only. No surgical review claimed.
- **Branch-protection settings for `main`** (REPO_RULES Appendix A) — unverifiable from source; documented settings are internally consistent with the gate wiring.
- **`backend/.env`** was deliberately NOT opened by Worker 6 (to avoid surfacing real secret values); only `git check-ignore` / `git ls-files` were used to confirm it's gitignored and untracked.

---

## 9. Final Statement on Audit Completeness

**This audit is COMPLETE within the stated scope and constraints.**

- All 6 workers reached full scope coverage (no `partially verified` left except the policy-exempted lockfiles and the R15-governed historical docs listed in Section 8).
- Total agents used: **7** (6 workers + 1 coordinator). Nested subagents: **0**. Within the 1+6 first-wave cap and the 8-agent hard cap.
- **No source files were modified** by the audit. This audit file is the only write — a documentation-only addition mandated by R6 itself.
- Branch-only workflow followed (see Rule 9 below); no direct commit to `main`.

**Highest-priority carry-out items (NOT applied — this audit is read-only; recording for follow-up), in order:**

1. **H-1** — drop `jobId` from every `repeat` cron-add in `dailyReportWorker.ts` and `sprintWorker.ts` (or adopt `upsertJobScheduler`). This single fix restores 18 silent-broken scheduled pipelines including the weekly full-portfolio audit sweep.
2. **H-2** — add `event.subtype`/`event.bot_id` filter in `slackEvents.ts:163-185` before Slack comes online; otherwise the roundtable synthesis echo + external-agent top-level replies both break the moment `SLACK_BOT_TOKEN` is set.
3. **H-3** — pin `dependency-check/Dependency-Check_Action@<sha>` instead of `@main`.
4. **M-6** — `weekly-audit` cron must use `getDefaultBranch()` like prior bug #31 fixed for the other two routes.
5. **M-7 + M-8** — gate really should run build/test for the monorepo (add a root workspace file or have gate.yml invoke `npm ci` per subproject explicitly); fix the wrong start command in RAILWAY_SETUP.md.
6. **TD-1..TD-4** — fix the misleading tests; they currently pass under any input and provide no regression protection.
7. **DM-1** — annotate `ConfirmedBugs.md` bug #11 as superseded (R15) since current code deliberately enshrines the original behavior.

Per R11 (do not walk past pre-existing bugs) and R12 (deferred work must survive the session), the carry-out items above should either be tackled in a follow-up PR or appended to `docs/governance/DEFERRED_WORK.md` if they need to wait for Shayan's prioritisation. No paid-API/infra spend implications (R24). No file deletions proposed (R14).

---

## Rule 9 / Rule 26 / Rule 27 Compliance: Branching

| Branch | Purpose | Pushed | PR |
|---|---|---|---|
| `docs/opencode-fullrepo-audit-2026-07-25` | This audit file (doc-only addition per REPO_RULES R6) | pending (local) | pending (per R26 — Shayan's approval required to merge) |

- No direct commits to `main`.
- No force-push.
- Branch name follows R27 (`docs/<short-slug>`, kebab-case, ≤ 40 chars).
- Conventional commit subject: `docs(audit): 2026-07-25 Opencode full-repo bug audit (3 Highs, 9 Mediums, 29 Lows)`.
- PR body will list R6 (audit naming), R3 (truthfulness table), R5 (basis: code + docs + prior audits), R7 (privately-saved under `audits/`), and this audit file path as verification evidence per R38.
