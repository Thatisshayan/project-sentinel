# Slack + Multi-Agent Roster Plan

**Created:** 2026-07-22
**Last updated:** 2026-07-22 (round 7 — Phase 0 first slice shipped)
**Status:** In progress — see "Implementation log" below
**Owner:** thatisshayan

## 0. Implementation log

Standing rule from this point on: bugs found during implementation are fixed
immediately (not just noted), each shippable increment is committed, and
this doc is updated in the same pass — see commits below for what's actually
landed vs. still just designed above.

- **2026-07-22, commit `b55ec64`** — fixed two pre-existing bugs found while
  building Phase 0 (unrelated to this plan, fixed first per standing rule):
  `telegramClient.ts` imported a `./retry` module that didn't exist anywhere
  in the repo (broke `tsc --noEmit` and 3 test suites — added
  `backend/src/retry.ts`); `dbClient.ts`'s `resolveSslConfig()` computed
  `isRailwayInternal` but never used it, so production DB connections always
  required strict cert verification regardless of host (breaking Railway's
  internal self-signed-cert case), while non-production returned
  `{rejectUnauthorized:false}` (SSL on, unverified) instead of disabling SSL
  outright — fixed to match the behavior the existing test file already
  described.
- **2026-07-22, commit `5ae2961`** — **Phase 0, first slice shipped:**
  `backend/src/commandRegistry.ts` — verb-first command dispatch (`audit
  <repo>`, `sprint status`, `security scan <repo>`, etc., matching the
  canonical rename list in section 1.3) routed into the *existing*
  `commands/*.ts` handlers unchanged, wired into `telegramCommands.ts` ahead
  of AI free-text routing. Legacy `/sentinel <subcommand>` syntax still
  works untouched. 6 new tests (`commandRegistry.test.ts`), full suite
  (37/37 files, 276/276 tests) and `tsc --noEmit` clean.
  **Known deviation from section 1.3's exact rename table:** `execute <repo>
  force` and `skip <repo> batch <n>` don't tokenize as a clean verb-first
  prefix (arg falls mid-command), so they're implemented as `execute force
  <repo>` and `skip batch <repo> <n>` instead — modifier before the arg.
  Section 1.3's table below has **not yet been corrected** to match; treat
  the implementation (file header comment in `commandRegistry.ts`) as
  authoritative for these two until the table is updated.
  **Not yet built:** the `CommandContext`/platform-agnostic interface Phase
  0 originally scoped (section "File-level changes" below) — this slice
  proves the verb-first syntax works but the handlers are still
  Telegram-shaped (`chatId`/`topicId` params, not a `CommandContext`
  object). That's a larger, higher-risk mechanical refactor across 4 handler
  files best done as its own reviewed unit — deferred in favor of shipping
  Phase 2 next, which the plan's own "Suggested next action" already flagged
  as the cheapest phase to start in parallel (no Slack/command-layer
  dependency).
- **2026-07-22, commit `919699f`** — **Phase 2, first slice shipped:**
  `POST /webhook/coderabbit` (`backend/src/webhook.ts` +
  `backend/src/webhook/processCodeRabbitEvent.ts`) receives CodeRabbit's
  PR-review-complete webhook, normalizes findings into `audit_tasks` (new
  `source` column, default `'sentinel'`, set to `'coderabbit'` for these),
  and posts a brief severity-summary notification. 8 new tests. Full suite
  38/38 files, 284/284 tests, `tsc --noEmit` clean.
  **Explicitly NOT verified (flagged in code comments, not guessed past):**
  CodeRabbit's real webhook payload shape and signature-header name/scheme
  — both were unknowns going in (section 2's research-pending list) and
  remain unknowns; the implementation assumes a GitHub-convention-like shape
  (`repository.full_name`, `pull_request.head.sha`, a findings array) and a
  GitHub-style `sha256=` HMAC under a guessed header name
  (`x-coderabbit-signature-256`), isolated behind `normalizePayload()` and
  `verifyCodeRabbitSignature()` respectively so a correction only touches
  one function each. **Must be checked against a real CodeRabbit webhook
  delivery before this goes live** — do not point CodeRabbit's dashboard at
  this endpoint yet.
  **Not yet built:** the `claudeCodeAudit.ts` fallback-timeout path (still
  primary/only audit engine in practice until this is wired in), the
  audit-summary reuse in `auditSummaryFormatter.ts` described in Phase 2's
  design (this slice's summary formatting is local to
  `processCodeRabbitEvent.ts`, not yet shared with Telegram's existing
  audit-complete message), and Slack posting (Phase 1 doesn't exist yet —
  notification is Telegram-only for now).

**Flagged 2026-07-22 (round 7): the two largest remaining pieces both touch
wide production surface area and are deliberately NOT being done as a fast
autonomous pass:**
- **Fallback-timeout wiring** — `triggerAudit()` (the function that would
  need to become "fallback-only, timeout-gated") is called from 9 different
  call sites across the codebase (`crossRepoCoordinator.ts`, `api.ts` ×2,
  `commands/repoOps.ts`, `repoOnboarder.ts`, `telegramAI.ts`,
  `telegramCommands.ts`, `workers/buildPollWorker.ts`,
  `workers/dailyReportWorker.ts`). Making it conditional on "did CodeRabbit's
  webhook already handle this commit" is a change to the actual production
  audit-trigger path everywhere, not a contained addition — deserves a
  deliberate per-call-site review, not a blind pass.
- **`CommandContext` refactor** (Phase 0's remaining piece) — touches all 4
  command handler files across roughly 150 call sites of
  `sendTelegramMessage`/`chatId`/`topicId`. Also deliberately deferred as its
  own reviewed unit rather than rushed.

Both are real, both are next — just flagged here as "picked up carefully,
not skipped" rather than attempted in the same fast cycle as the smaller
slices above.

- **2026-07-22, commit `9dcc250`** — **fallback-timeout wiring shipped, with
  narrowed scope.** Investigation showed only 1 of the 9 `triggerAudit()`
  call sites is genuinely automatic/PR-driven in the same sense CodeRabbit's
  own GitHub App is (`workers/buildPollWorker.ts`'s human-commit-build-passed
  path) — the other 8 are manual commands, onboarding, or AI-triggered,
  which are explicit human requests and correctly still run immediately,
  unchanged. Only that one call site now schedules a delayed
  `coderabbit-fallback-audit` BullMQ job (default 45min,
  `CODERABBIT_FALLBACK_DELAY_MIN` env var) instead of auditing immediately;
  `hasCodeRabbitAuditedCommit()` (new, `auditDb.ts`) gates whether the
  fallback actually runs when the delay elapses. If scheduling itself fails,
  falls back to an immediate `triggerAudit` so no commit is ever silently
  unaudited — same failure-visibility principle as the existing
  `scheduleApprovalTimeout`. 6 new/updated tests across
  `scheduledJobsWorker.test.ts` and `buildPollWorker.test.ts`. Full suite
  38/38 files, 288/288 tests, `tsc --noEmit` clean.
  **This resolves the "8 other call sites" concern raised when this was
  first flagged — it was never actually 9 call sites needing the same
  treatment, only 1.**

- **2026-07-22, commit `4bd99e1`** — **Phase 1, first slice shipped, with a
  design revision that changes what the `CommandContext` refactor above
  actually needs to cover.** Realization: `sendTelegramMessage(text,
  repoName, topicId)` already carries `repoName` on every one of its ~150
  call sites — enough context to also post to Slack directly, without
  threading a new `CommandContext` object through every command handler.
  Added `slackClient.ts` (raw-https `chat.postMessage`, same low-dependency
  style `telegramClient.ts` already uses for outbound Telegram sends — no
  `@slack/bolt` needed for this piece) and a `slack_channels` table
  (`repo_name` → `channel_id`). `sendTelegramMessage()` now fires a
  non-blocking `sendSlackMessage()` alongside every existing send — **every
  one of the ~150 call sites gets Slack delivery for free, with zero changes
  to any of them.** Safe by construction: with no `SLACK_BOT_TOKEN` or no
  mapped channel for a repo, it's a no-op (resolves `null`, logs at debug) —
  current behavior is unchanged until real Slack credentials and channel
  mappings exist. 6 new tests. Full suite 39/39 files, 294/294 tests, `tsc
  --noEmit` clean.
  **This substantially shrinks what the `CommandContext` refactor actually
  needs to do.** It was originally scoped as "rewrite every handler to take
  a platform-agnostic context object" — but *outbound delivery* (the bulk of
  what those 150 call sites do) is now solved without touching them. What's
  genuinely still needed for full Slack parity is narrower:
  1. **Inbound**: a Slack Events API / Bolt listener that receives
     `@mention`s and slash commands and calls the *same*
     `commandRegistry.dispatchCommand()` Phase 0 already built — this needs
     new code (a Slack-side entry point) but not a rewrite of the 4 handler
     files, since they already work by calling `sendTelegramMessage`, which
     now also reaches Slack.
  2. **Interactive components** (buttons/menus) — `telegramMenus.ts`'s
     inline-keyboard buttons don't have a Slack Block Kit equivalent yet;
     approve/skip flows would be text-only in Slack until this is built.
  3. **Channel auto-creation during onboarding** — `upsertSlackChannel()` is
     built and exported but not yet called from `repoOnboarder.ts`; until it
     is, `slack_channels` stays empty and Slack delivery stays a no-op even
     with a real token configured.
  None of these three require rewriting the existing command handlers —
  they're additive, which is a meaningfully smaller and safer scope than
  the original Phase 0 "CommandContext across 150 call sites" plan.
- **2026-07-22, commit `304d4a2`** — **item 3 above shipped:** channel
  auto-creation during onboarding. `createChannelForRepo()` (slackClient.ts)
  creates `#<reponame>` via `conversations.create`, reuses the existing
  channel if the name is already taken (`conversations.list` lookup), and
  persists the mapping. Wired into `repoOnboarder.ts`'s `onboardRepo()` with
  the exact same best-effort pattern already used for Notion-row and
  GitHub-webhook creation there — never blocks onboarding, and the summary
  message accurately reports ✅/❌ rather than assuming success (same
  honesty bar as the existing Notion/webhook reporting, which had its own
  prior regression around false "✅" claims — see `full_bug_scan_done`
  session history). 10 new/updated tests. Full suite 39/39 files, 300/300
  tests, `tsc --noEmit` clean.
  **Remaining for full Slack parity (items 1-2 from the list above):**
  inbound Events API/Bolt listener (nothing can be typed *in* Slack and
  reach Sentinel yet — this is the next real blocker for calling Phase 1
  "done"), and Block Kit buttons for the approve/skip/menu flows
  (`telegramMenus.ts`'s equivalents). Both still don't require touching the
  4 command-handler files' internals.
- **2026-07-22, commit `754e313`** — **item 1 shipped: inbound Events API
  listener.** `POST /webhook/slack/events` (`slackEvents.ts`) answers
  Slack's `url_verification` handshake, verifies requests with Slack's real
  documented v0 HMAC-SHA256 signing scheme (not a guess — this one is
  genuine public API documentation, unlike CodeRabbit's payload shape in
  Phase 2, which remains unverified), and routes `app_mention` text (bot
  mention stripped) through the *same* `commandRegistry.dispatchCommand()`
  Phase 0 built for Telegram — Slack and Telegram now share identical
  command-handling logic, only the inbound transport differs. 13 new tests.
  Full suite 40/40 files, 313/313 tests, `tsc --noEmit` clean.
  **Known gap, surfaced honestly rather than glossed over:** many existing
  command-handler reply call sites pass `repoName: null` to
  `sendTelegramMessage` (they rely on Telegram's `topicId` for routing
  instead) — `slackClient.ts`'s fan-out looks up the destination channel by
  `repoName`, so those specific replies will silently no-op in Slack even
  once fully configured with real credentials. This means "type `@sentinel
  audit costpilot` in Slack" will correctly *trigger* the audit (dispatch
  works), but some of the resulting status messages may only land in
  Telegram until the affected call sites are audited and given a real
  `repoName`. Not fixed in this slice — flagged as the next concrete
  follow-up rather than left implicit.
  **Remaining for full Slack parity: only item 2 (Block Kit buttons for
  approve/skip/menu) plus the repoName-null audit above.**
- **2026-07-22, commit `36031c9`** — **the repoName-null audit shipped,
  done properly this time.** The first attempt at this (same day, mid-cycle)
  was abandoned after a regex-based sweep (`sendTelegramMessage\([^,]+,\s*
  null,`) turned out to miss multi-line calls — rather than ship an
  incomplete/inconsistent fix, it was deferred. Redone by reading
  `commands/repoOps.ts` and `commands/reports.ts` function-by-function
  directly: ~17 call sites fixed (stop/status/builds/retry, execute, audit,
  tasks, skip-batch, lock/unlock, force-execute, security's per-repo
  branch, security-scan, security-approve, reset-failed, `business <repo>`,
  `impact <repo>`). Left as `null` where it's actually correct: usage/error
  messages with no repo parsed yet, and genuinely portfolio-wide summaries
  (bare `security`, `repos scan`, `sync-metrics`). `commands/agents.ts` and
  `commands/sprint.ts` were audited too and need no changes — neither has
  any repo-specific reply. 9 new/updated tests. Full suite 41/41 files,
  319/319 tests, `tsc --noEmit` clean.
  **Phase 1 is now functionally complete except Block Kit buttons** (item 2)
  — every repo-specific Sentinel reply reaches Slack once real credentials
  and channel mappings exist; approve/skip/menu flows remain text-only in
  Slack until buttons are built.
- **2026-07-22, commit `f643cdd`** — **Phase 1 complete (as originally
  scoped).** Block Kit buttons shipped for the primary audit
  execute/skip flow: new `express.urlencoded()` body parser (Slack's
  interactivity payloads use a different content type than every other
  webhook this app receives), `sendSlackButtons()` in `slackClient.ts`, a
  new `POST /webhook/slack/interactions` receiver
  (`slackInteractions.ts`) that routes button clicks to the exact same
  `executeApprovedTasks`/`stopAllTasksForRepo` functions Telegram's
  callback handler already calls, and `auditOrchestrator.ts`'s
  audit-complete notification now sends both platforms' buttons side by
  side. 13 new tests. Full suite 42/42 files, 329/329 tests, `tsc --noEmit`
  clean.
  **Deliberately out of scope, noted in file headers, not implied
  complete:** this covers only the execute/skip flow — `telegramMenus.ts`
  has several other menu types (main menu, repo control panel, approvals
  menu, help sections) that remain Telegram-only. Extending those to Slack
  would follow the exact same pattern now established (button grid →
  `sendSlackButtons`, `action_id` → handler in `slackInteractions.ts`) —
  not attempted here since none of them block calling Phase 1 "done" the
  way execute/skip did.
  **Phase 1 summary — what actually works end-to-end now, pending only real
  Slack credentials + channel mappings:** `@mention` commands dispatch
  identically to Telegram; every repo-specific reply fans out to the
  correct Slack channel; audit-complete notifications include working
  execute/skip buttons in both platforms; new repos get their Slack channel
  auto-created on onboarding.
- **2026-07-22, commit `837fa28`** — **Phase 4, dispatch half shipped.** New
  `external_agents` table (`backend/src/agents/externalAgentRegistry.ts`),
  seeded idempotently with the confirmed roster — Kilo, Viktor, Devin,
  Manus, CodeRabbit — each with its Slack `@mention` handle and role
  (worker/authority/auditor). `dispatchToAgent(agentId, task, repoName)`
  posts `@mention task` into the repo's channel via the existing
  `sendSlackMessage`. The roster is genuinely data now — adding agent #6 is
  an `INSERT`, matching the round-4 design goal. 10 new tests. Full suite
  43/43 files, 339/339 tests, `tsc --noEmit` clean.
  **Deliberately not built in this slice (scope boundary, not an oversight):**
  reply correlation — nothing yet watches a channel for an agent's response
  and ties it back to the task that was dispatched (`threadWatcher.ts` from
  the original design). Right now `dispatchToAgent` can *send* a task but
  Sentinel has no way to know when/whether the agent replied. This needs
  `slackEvents.ts` to also subscribe to plain `message` events (currently
  only `app_mention`) plus a pending-dispatch tracking table to correlate
  by channel + thread — real follow-up work, not started. No command yet
  calls `dispatchToAgent` either (e.g. a `assign <agent> <repo> <task>`
  command) — the function exists and is tested but isn't wired into the
  command layer yet.
- **2026-07-22, commit `b265ee7`** — **Phase 4 complete — both connective
  pieces shipped.**
  1. **Reply correlation**: new `agent_dispatches` table (agent, repo,
     task, Slack channel, dispatch `ts`, status). `dispatchToAgent()` now
     records a row on every successful dispatch. `slackEvents.ts` now also
     handles plain `message` events (previously only `app_mention`); a
     threaded reply's `thread_ts` is checked against pending dispatches via
     `recordAgentReply()`, a safe no-op for the vast majority of channel
     traffic that isn't a reply to anything Sentinel sent.
  2. **`assign <agent-id> <repo> <task description>` command** — the first
     command to actually call `dispatchToAgent`. Wired into both
     `commandRegistry.ts` and `commands/agents.ts`; the missing-args usage
     message lists the live enabled-agent roster rather than a hardcoded
     list.
  18 new tests. Full suite 44/44 files, 348/348 tests, `tsc --noEmit`
  clean.
  **Still open, explicitly not verified:** the Slack app's Events API
  subscription needs `message.channels` added alongside `app_mention` for
  any of this to receive real events in production — this is a Slack
  dashboard configuration step, not code, and hasn't been checked against a
  real app. Also still open: whether *other apps'* bot messages (Kilo's,
  Manus's own replies) are actually delivered to a subscriber's endpoint at
  all, or whether Slack filters bot-to-bot traffic by default — flagged
  since round 1, still unverified, now the single biggest remaining
  question mark for whether reply correlation works in practice.
- **2026-07-22, commit `ec95761`** — **roster corrected against reality.**
  Owner connected all agents to the real Slack workspace and the actual
  `@mention` handles turned out lowercase (`@kilo`, `@viktor`, `@devin`, not
  the capitalized guesses seeded earlier from public docs), plus three
  agents not in the original design at all: **`@claude`, `@codex`, and
  `@hermes`** — all added as dispatchable workers. **`@hermes` is a real
  correction to Phase 5's design** (section "Phase 5 — Hermes Agent as
  personal assistant" above): it's Slack-native, not the hosted
  OpenAI-compatible API originally assumed — dispatched the same
  `@mention` way as the rest of the roster now, while still keeping a
  dedicated channel for the personal-assistant use case per the original
  intent. `@github` and `@slackbot` confirmed as Slack's own bots, not
  agents — not added. Seed logic changed from `DO NOTHING` to `DO UPDATE`
  (excluding `enabled`) so future handle corrections just need a redeploy,
  not a manual DB fix. 13 updated tests, full suite green. **Historical
  mentions of `@Kilo`/`@Viktor`/`@Devin` (capitalized) elsewhere in this doc
  reflect what was believed at the time they were written — this entry is
  the current source of truth, not those.**
- **2026-07-22 — production deployment log (separate from feature commits
  above):** the last successful deploy before this session was 2026-07-19;
  a build pushed after that (before this session started) broke on the
  exact same `retry.ts`/SSL bug fixed in commit `b55ec64`, leaving
  production silently stuck on 3-day-stale code with every deploy attempt
  since failing. Verified via `railway deployment list` + `railway logs
  --build`. Redeployed via `railway up` (uploads the local working tree
  directly, independent of whether commits have been pushed to the git
  remote) once `b55ec64` was in place — confirmed via `railway status`
  (Online) and a live `url_verification` curl test against
  `/webhook/slack/events` (200, correct echo). **Local commits have NOT
  been pushed to `origin/main` yet** — Railway's deploys in this session
  went via `railway up` from the local tree, not git-triggered auto-deploy;
  pushing is still owed as a separate step so GitHub reflects what's
  actually running.
- **2026-07-22, commit `c126bae`** — **Phase 2 corrected: CodeRabbit has no
  self-serve outbound webhook for GitHub.** Owner checked the CodeRabbit
  dashboard and couldn't find one — confirmed via docs research: for
  GitHub, CodeRabbit's webhook relationship is GitHub → CodeRabbit, not
  the reverse. `processCodeRabbitEvent.ts`/`/webhook/coderabbit` (the
  original design) is now dormant infrastructure — not wrong to have kept,
  but will not receive real traffic on this GitHub-based setup. **The real
  ingestion path**, per the owner's "both" decision: new
  `processCodeRabbitPRComment.ts` recognizes `pull_request_review_comment`
  events (delivered through the *existing* `/webhook/github` route, not a
  new endpoint) authored by CodeRabbit's bot account and ingests each as an
  `audit_tasks` row, same `source='coderabbit'` tagging as before.
  CodeRabbit's native Slack presence (`@coderabbit`, already connected)
  covers the "both" other half — no code needed there, it's their own
  product behavior.
  **Verified against a real payload was NOT possible** — `coderabbitai[bot]`
  is CodeRabbit's publicly known GitHub App login, assumed but not yet
  confirmed against an actual delivery.
  `repoOnboarder.ts`'s webhook registration updated to include
  `pull_request_review_comment` for future repos.
  **Also fixed while in there:** this repo's own GitHub webhook was missing
  plain `pull_request` entirely (unrelated pre-existing gap, patched
  directly via `gh api`) alongside adding the new event type. **The other
  10 already-onboarded repos still need the same backfill — not done, no
  script written yet.**
  **Also discovered, not yet acted on:** Snyk is already connected to this
  repo via its own GitHub webhook (`api.snyk.io/webhook/github/...`) — some
  Phase 3 groundwork may already exist on the account side, worth checking
  before building Snyk integration from scratch.
  10 new tests. Full suite 45/45 files, 358/358 tests, `tsc --noEmit`
  clean.
- **2026-07-22, commit `20bc919`** — **self-caught race condition, fixed.**
  While doing an honest self-audit at the owner's request, found that
  `processCodeRabbitPRComment.ts` computed the next `task_number` from a
  repo-wide count (wrong scope — should be per audit cycle) with no
  locking, meaning concurrent webhook deliveries for the same PR
  (CodeRabbit often posts several inline comments in a burst) could race
  and silently create two tasks with the same `task_number`. Fixed with a
  new `idx_audit_tasks_cycle_tasknum` unique index (fails loud instead of
  silently duplicating) plus a correctly cycle-scoped
  `getNextTaskNumberForCycle()` and a bounded 5-attempt retry loop keyed on
  the specific Postgres collision code (23505) — a genuine unrelated DB
  error still fails fast. Also fixed: the function previously logged
  "ingested" and sent a Slack/Telegram notification even when every retry
  attempt failed. **Verified no pre-existing duplicate `(audit_cycle_id,
  task_number)` data existed in production before adding the unique index**
  (queried live via Postgres's public proxy — a blind `CREATE UNIQUE INDEX`
  could otherwise have failed the whole migration at next startup). 3 new
  regression tests. Full suite 45/45 files, 361/361 tests, `tsc --noEmit`
  clean.
- **2026-07-22 — branch cleanup.** Audited all 36 remote branches
  individually (git commit-count + `comm -23` file-existence checks +
  GitHub PR `mergedAt` status, not just raw `git log` ahead-counts, which
  are misleading for squash-merged branches). Deleted 24 confirmed-merged
  branches after owner approval. Left untouched: PR #24
  (`feat/phase4-test-coverage`, still open on GitHub with content already
  present in `main` via PR #26's redo — owner has not yet decided whether
  to close it), two historical snapshot branches
  (`backup-local-main-pre-merge`, `phase1-typescript-foundation`), and all
  9 Dependabot branches (genuinely pending, not stale).
- **2026-07-22 — production deploys, cumulative.** Slack credentials
  (`SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`) set via Railway CLI (already
  authenticated/linked — confirmed during this session) from the owner's
  real Slack app, created via the generated manifest
  (`docs/slack-app-manifest.json`). Sentry DSN also set
  (`SENTRY_DSN`, reusing an existing `obsidian-xk/node` Sentry project's
  "Default" key — dedicated-project creation is disabled for org members)
  but explicitly parked at the owner's request, not otherwise wired up
  further this session. Multiple `railway up` redeploys shipped
  today's commits to production progressively; each verified via `railway
  status` (Online) rather than assumed.
- **2026-07-22, commit `aab0349`** — **found and fixed live in production
  logs, not from a test:** setting `SENTRY_DSN` today (the first time it
  had ever been set) surfaced a dormant unhandled-promise-rejection at
  every startup — `index.ts` dynamically imported `@sentry/express`, which
  was never actually an installed dependency (only `@sentry/node` is in
  `package.json`). `@sentry/node` v8 already exports `expressIntegration()`
  directly; moved it into `Sentry.init()`'s `integrations` array (the
  correct v8 pattern) and deleted the broken import entirely. Confirmed via
  live `railway logs` before and after the fix, not just local tests.
- **2026-07-22 — Slack channel backfill, run live against production.**
  `createChannelForRepo()` only ever ran during *new* repo onboarding — the
  11 repos onboarded before Slack existed had no channel/mapping. Wrote
  `backend/scripts/backfillSlackChannels.js` (standalone, not a TS import,
  to avoid needing a build step for a one-off run) and ran it via `railway
  run` against the real Slack API and the production DB (via Postgres's
  public proxy, same technique used earlier to check for duplicate
  `task_number` data). **Result: 18 real Slack channels created/mapped**,
  confirmed by row count. This is the first genuine end-to-end proof that
  Slack channel creation works against the real API, not just mocks.
  Incidentally surfaced a pre-existing data-quality inconsistency (not
  fixed, out of scope) — `portfolio_metrics` has repo names in inconsistent
  casing/spelling (`session-guard` vs `sessionguard`,
  `obsidian-studio` vs `obsidianstudio`), which produced one real channel
  per spelling variant rather than per actual repo.
  **Still not done:** the bot/other agents (Kilo, Manus, etc.) are not
  automatically invited into these channels — creating a channel via API
  makes the bot the owner but doesn't invite anyone else; that's still a
  manual `/invite` step per channel per agent. A real `@mention` round-trip
  and Interactivity button click have also still not been tested live —
  only the channel-creation and `url_verification` handshake paths have
  been empirically confirmed so far.
- **2026-07-22 — live `@mention` testing attempted, blocked, parked (owner
  call, not resolved).** The Sentinel bot's Slack username auto-suffixed to
  `sentinel2` (a different, pre-existing app already owns `@sentinel` in
  this workspace) — confirmed genuinely installed (`auth.test` returns a
  valid token for `user: sentinel2`, team `ObsidianMedia`; the app "Project
  Sentinel" is visible in the workspace's Apps list) and confirmed a member
  of every repo channel via `users.conversations`. **Despite all of that,
  `@sentinel2` never appears in Slack's inline mention-autocomplete
  dropdown**, and zero HTTP requests have ever reached
  `/webhook/slack/events` in production (checked via `railway logs --http`
  and `--since`-scoped deployment logs) even after a full reinstall. Root
  cause not identified — candidates not yet ruled out: workspace-level
  app-approval/restriction (couldn't verify without `admin.apps:read`,
  which needs an admin-scoped token requiring its own separate consent
  flow), a Slack client-side cache/propagation delay for newly created bot
  users, or something in the Events Subscription config that looks correct
  in the dashboard but isn't actually active. **Owner explicitly parked
  this — do not assume it's fixed, and do not claim `@mention` dispatch
  works until a real message is confirmed reaching
  `/webhook/slack/events` in production logs.**

## 1. Goal

Bring Slack online as a full parallel channel to Telegram, and expand Sentinel's
agent roster beyond its own AI-model pool to include specialized external tools:
CodeRabbit (code auditing), Snyk Code + Qodo (security/testing), Manus + Kilo
(additional coding-task workers), Viktor AI (delegate-authority "temporary CEO"),
Hermes Agent (personal assistant), and a Bloome-style multi-agent "roundtable"
channel where several agents answer the same prompt and Sentinel synthesizes the
result.

Nothing in this document should be treated as decided-and-final for the phases
marked "research pending" — those need a live spike (real account, real API call)
before implementation starts, because vendor docs found via web search can be
stale, aspirational, or marketing copy rather than an accurate contract.

## 1.1 Decisions confirmed 2026-07-22 (round 2)

These override anything in the sections below that assumed otherwise —
sections further down have been edited to match, but if a conflict is ever
spotted, **this list wins**.

1. **CodeRabbit is invoked by webhook; everyone else in the Slack-native
   stack is invoked by `@mention`.** (Round 3 correction — CodeRabbit is the
   one exception, not part of the "no API keys" rule below.) Kilo, Viktor,
   Devin, Manus, and future worker/authority additions are invoked purely via
   `@mention` inside Slack, no API keys, exactly as their own product docs
   describe. CodeRabbit uses its documented webhook (PR-review-complete
   events) as its trigger/result path instead — this needs its own design
   pass (see Phase 2, marked "needs development" below) since it's the odd
   one out mechanism-wise.
2. **CodeRabbit is now the primary audit engine**, replacing
   `claudeCodeAudit.ts`'s role for both Slack and Telegram — this is Option B
   from the old Phase 2 draft, not Option A. Sentinel's own Claude-based
   auditor is demoted to fallback/business-impact-scoring support, not the
   primary code-review engine.
3. **The agent roster is an open, extensible list** — Kilo, Viktor, Devin,
   Manus, CodeRabbit today, with more to be added later. Nothing should be
   built that hardcodes "5 agents" — the roster lives in a DB table /
   registry, not a fixed enum, so adding agent #6 is a data change, not a
   code change.
4. **Command renaming needs a dedicated design session** — not resolved in
   this document. Interactive-command *mechanism* is scoped (see 1.3 below)
   but the actual new command names/taxonomy are still open.
5. **Naming convention:** Slack channels are named `#<reponame>` — **no**
   `sentinel-` prefix. Repo name uses the same normalized form
   `repoResolver.ts` already produces internally (verify exact normalization
   — lowercase, hyphenated — against that file at implementation time,
   don't assume). This same normalized name is the join key across Slack
   channels, DB records, and Telegram topics — one canonical repo identifier,
   three surfaces.
6. **Roundtable is per-repo**, invoked by `@mention` (or a similar trigger
   pattern — exact invocation syntax still open, see Phase 7) inside that
   repo's channel — not a single global roundtable channel.

## 1.2 Memory model

You confirmed **all four** memory layers are wanted — they're complementary,
not alternatives, so this isn't "pick one," it's "build all four, each with
a distinct scope and store":

| Layer | Scope | Store | Consumed by |
|---|---|---|---|
| **Per-agent memory** | One external agent's history in one repo channel | Not duplicated — Slack's own thread/channel history IS this memory. Sentinel reads it via `conversations.history`/`conversations.replies` when it needs context, rather than storing a copy. | Any dispatch to that specific agent — Sentinel can quote/summarize recent thread history into a new task prompt. |
| **Per-repo shared context** | Everything Sentinel itself knows about one repo — past audits, decisions, task outcomes, across *all* agents that touched it | A living document per repo (Notion "Current Context" section + in-repo `CONTEXT.md`, kept in sync) — **not** a raw DB log, see design below | Every dispatch to any agent for that repo — the doc/link is injected so agents aren't cold-starting each time. |
| **Cross-repo portfolio memory** | Patterns across the whole portfolio — recurring bug types, agent performance/reliability, decision trends | Largely already exists in spirit (`sentinelBrain.ts`, `patternDetector.ts`, `agentLeaderboard.ts`, `correlationEngine.ts` — **verify overlap with these before building something new**; this may be an extension of existing tables, not a new subsystem) | Strategic reports (CEO report, brain), and to help Viktor/roundtable synthesis reason about "has this happened before, across repos." |
| **Roundtable-specific memory** | Past roundtable questions + their syntheses, so a repeated question doesn't restart from zero | New DB table (`roundtable_sessions`, already drafted in old Phase 7 — extend with a similarity/lookup path) | The roundtable synthesis step itself — "we asked something like this before, here's what came of it." |

### Per-repo shared context: living document, not a raw log (round 3 design)

**Confirmed (round 3):** instead of agents pulling from a raw
event-log table, each repo gets **one living context document** that
Sentinel keeps current and agents are told to read as part of their dispatch
prompt. This is simpler for agents to consume (one coherent narrative, not a
log dump to re-summarize every time) and doubles as a human-readable status
page for you.

**Confirmed: both locations, kept in sync:**
- **Notion** — extends the per-repo project page Sentinel already maintains
  (`notionClient.ts`/`findNotionProject`) with a "Current Context" section —
  reuses existing sync infra, no new external system. This is the
  human-facing view.
- **In-repo `CONTEXT.md`** — committed to each repo, updated by Sentinel via
  commit. This is what agents whose Slack integration is thin on custom
  prompt-injection (or any future IDE-side integration, e.g. if Kilo's IDE
  extension is ever used directly per its shared-account model — see Phase 4
  Kilo note) can read straight from the filesystem, no API call needed.

**Confirmed: update after every audit/sprint/decision**, not batched — the
doc should be current whenever an agent is dispatched, not up to a day
stale.

### File-level changes

- **New:** `backend/src/repoContextDoc.ts` — `updateRepoContext(repoName,
  event)` — appends/rewrites the "Current Context" section (Notion, via
  existing `notionClient.ts` patterns) and commits an updated `CONTEXT.md`
  (needs a small git-write helper — check whether one already exists, e.g.
  something `securityPatcher.ts`/`repoOnboarder.ts` already uses for
  repo-write access, before building a new one).
- **Call sites to add:** `auditOrchestrator.ts` (after an audit completes),
  `sprintOrchestrator.ts` (after sprint approval/completion),
  `securityScanner.ts`/`securityPatcher.ts` (after a scan/patch), and the new
  Phase 6 Viktor-authority log (any Viktor decision should also land here).
- **Content shape (draft, refine once real usage shows what's actually
  useful — don't over-design before there's a consumer):** last audit
  summary + date, current sprint status, open security issues count/severity,
  recent decisions (last ~5, human-readable one-liners), and a pointer back
  to full history (Notion page / `audit_tasks` table) for anything deeper
  than a quick orientation.
- **Dispatch-time usage:** every `ExternalAgent.dispatch(...)` call (Phase 4)
  includes a link to (or, for Slack messages, an inline excerpt of) the
  repo's current `CONTEXT.md`/Notion context section, so agents start
  informed without Sentinel needing to reconstruct history per-dispatch.

This replaces the earlier draft `repo_agent_context` DB table design — no
new DB table needed for this layer; Notion + `CONTEXT.md` are the store.

## 1.3 Interactive commands — mechanism (not naming) scope

You selected **all three** mechanisms — these aren't mutually exclusive, they
cover different situations:

- **`@mention`-triggered natural language** — the default, low-friction path,
  consistent with how Kilo/Manus/Viktor/CodeRabbit/Devin themselves work in
  Slack. `@sentinel audit this repo` parsed by AI (reusing `telegramAI.ts`'s
  existing free-text-to-intent pattern, extended to Slack) rather than
  requiring exact slash syntax.
- **Slash commands** — kept for power users / scripting / precision (e.g.
  exact repo name, no ambiguity) — this is what Phase 0/1 already scope.
- **Block Kit buttons** — for the cases Telegram's `telegramMenus.ts`
  already uses inline keyboards (approve/skip, menu navigation) — ported to
  Slack's native button components.
- **Modals** — for anything needing structured input (e.g. picking a repo
  from a dropdown + setting options in one step) rather than typing
  positional args.

**Corrected (round 3): the `/sentinel <subcommand>` prefix goes away.** You
called it "waaay too hard" — confirmed direction: commands become direct
verb-first text, e.g. `audit <repo>` instead of `/sentinel audit <repo>`,
with an agent (likely Sentinel's own AI-routing layer, extending
`telegramAI.ts`'s existing free-text intent parsing) interpreting the verb
and args rather than a hand-written string-split router matching an exact
`/sentinel` prefix. This applies across both Telegram and Slack — one
consistent, low-friction syntax on both platforms, not just Slack.

Practical effect on Phase 0: `commandRegistry.ts`'s `dispatchCommand` should
resolve command names from a short verb list (`audit`, `security`, `sprint`,
`repos`, etc. — the ~50-command inventory in section "Current command
inventory," minus the `/sentinel ` prefix) matched either exactly (fast path)
or via the AI-routing fallback (handles typos/phrasing variance, e.g. "audit
the repo called X" still resolving to `audit X`). Both paths funnel into the
same `CommandContext`-based handlers either way — this doesn't change
Phase 0's architecture, only the surface syntax users type.

### Canonical command rename list (confirmed round 4 — reference list, not
just AI-inferred)

You confirmed you still want an explicit, written canonical name per command
— even though the AI-routing layer handles loose phrasing at runtime, this
list is the source of truth for docs/help text/tests. Namespace-first
grouping (`sprint status`, `security scan <repo>`, `bots test`) also resolves
the original "too flat/sprawling" complaint from the very first design round.

| Old (`/sentinel ...`) | New |
|---|---|
| **Reports** | |
| `report` | `report` |
| `weekly` | `weekly` |
| `ceo` | `ceo` |
| `costs` | `costs` |
| `health` | `health` |
| `velocity` | `velocity` |
| `patterns` | `patterns` |
| `business <repo>` | `business <repo>` |
| `impact <repo>` | `impact <repo>` |
| `roi` | `roi` |
| **Agents** | |
| `agents` | `agents` |
| `what` | `active` (renamed — clearer than "what") |
| `standup` | `standup` |
| `leaderboard` | `leaderboard` |
| `bots` | `bots` |
| `test-bots` | `bots test` |
| `setup-bots` | `bots setup` |
| `memory` | `memory` |
| **Repos** | |
| `audit <repo>` | `audit <repo>` |
| `tasks <repo>` | `tasks <repo>` |
| `execute <repo>` | `execute <repo>` |
| `force-execute <repo>` | `execute <repo> force` |
| `stop <repo>` | `stop <repo>` |
| `skip <repo>` | `skip <repo>` |
| `skip-batch <repo> <n>` | `skip <repo> batch <n>` |
| `lock <repo>` | `lock <repo>` |
| `unlock <repo>` | `unlock <repo>` |
| `locked` | `locked` |
| `repo <name>` | `repo <name>` |
| `repos` | `repos` |
| `repos scan` | `repos scan` |
| `dashboard` | `dashboard` |
| **Sprint** | |
| `propose-sprint` | `sprint propose` |
| `approve-sprint` | `sprint approve` |
| `run-sprint` | `sprint run` |
| `sprint-status` | `sprint status` |
| `skip-sprint` | `sprint skip` |
| `pause-sprint` | `sprint pause` |
| `resume-sprint` | `sprint resume` |
| `approve` (pending-approvals list) | `approvals` (renamed — distinguishes from `sprint approve`, was ambiguous before) |
| **Security** | |
| `security` | `security` |
| `security <repo>` | `security <repo>` |
| `security-scan <repo>` | `security scan <repo>` |
| `security-patch <repo>` | `security patch <repo>` |
| `security-approve <repo>` | `security approve <repo>` |
| **System** | |
| `pause` | `pause` |
| `resume` | `resume` |
| `self-audit` | `self audit` |
| `self-approve` | `self approve` |
| `status <repo>` | `status <repo>` |
| `builds <repo>` | `builds <repo>` |
| `performance` | `performance` |
| `prompts` | `prompts` |
| `brain` | `brain` |
| `check-builder` | `builder check` |
| `sync-metrics` | `metrics sync` |
| `menu` | `menu` |
| `help` | `help` |

**Not yet decided:** which of the four interaction mechanisms (mention /
slash / buttons / modal) applies to which specific command from this list —
still open, but now a much smaller decision than the full taxonomy was (see
section 5, still-open item #1, narrowed accordingly).

## 1.4 Extensible agent roster (replaces the old fixed Phase 4 list)

Confirmed stack so far: **Kilo, Viktor, Devin, Manus, CodeRabbit** — explicitly
**not** a closed list; more will be added. This means Phase 4's design must
treat the roster as data, not code:

```sql
CREATE TABLE external_agents (
  id              TEXT PRIMARY KEY,     -- 'kilo' | 'viktor' | 'devin' | 'manus' | 'coderabbit' | ...
  display_name    TEXT NOT NULL,
  slack_mention   TEXT NOT NULL,        -- '@Kilo', '@manus', etc. — exact Slack bot handle
  role            TEXT NOT NULL,        -- 'worker' | 'auditor' | 'authority' | 'assistant'
  enabled         BOOLEAN DEFAULT true,
  added_at        TIMESTAMPTZ DEFAULT now()
);
```
Adding agent #6 (or #20) is an `INSERT`, not a code change — the dispatch
logic (`ExternalAgent` interface, section further down) reads this table
rather than a hardcoded `KNOWN_AGENT_IDS`-style array. This also means the
existing `KNOWN_AGENT_IDS` internal-model list and this new external-agent
table are two related but distinct rosters — internal AI-model agents
(`nvidia`, `qwen`, etc.) vs external Slack-native agents (`kilo`, `viktor`,
etc.) — **do not merge them into one table** unless a real need to treat them
identically shows up; they have different dispatch mechanisms (internal =
direct function call, external = Slack `@mention`).

---

## 2. Key architectural finding (research, 2026-07-22)

**Manus, Viktor AI, Kilo, and CodeRabbit are all native Slack apps** — they
install as their own bot user in a Slack workspace and are invoked by
`@mention`, not called as a headless API from Sentinel's backend:

| Tool | Slack presence | Programmatic hook (if any) |
|---|---|---|
| Manus | Installs via Settings → Integrations → Slack; `@manus` in any thread | Yes — `open.manus.im/docs/webhooks` (task-completion events, Node/Python examples) |
| Viktor AI | Listed on Slack App Marketplace (`A0A2VN5TR5K`); appears as a workspace member | Claims OAuth-based "3,200+ integrations" and "custom integrations on the fly" — no public webhook/API spec surfaced by search; **needs direct account inspection** |
| Kilo | "Kilo for Slack" — `@Kilo` in channel/DM, reads GitHub repos, opens PRs from chat | Kilo also has a CLI (per you) — relationship between the CLI and the Slack app is unconfirmed; **needs research** |
| CodeRabbit | "CodeRabbit Agent for Slack" — `@coderabbit` in channel/DM/thread | Also has a documented general API/MCP-server integration path (`docs.coderabbit.ai`) — you already have account access |

**This changes the integration model from what Phase 4 originally assumed.**
Instead of "Sentinel's backend calls Viktor's API," the more accurate shape is:
*Sentinel and these tools are peers in the same Slack workspace, and Sentinel's
job is to orchestrate the conversation* — mention the right bot, wait for its
reply, parse the thread, correlate it back to a task/audit/approval record in
Sentinel's own database. Direct API/webhook calls (where they exist — Manus,
CodeRabbit) are a *secondary, optional* faster path for the specific things
those webhooks cover (e.g., Manus task-completion events), not the primary
integration mechanism for "delegate a task to this bot."

**Open research items before implementation (do not build against assumptions):**
1. Does Viktor AI expose any API/webhook beyond the Slack presence, or is Slack
   the only surface? (Needed for Phase 6 authority/audit-log design.)
2. Is Kilo's CLI usable headlessly in CI/agent context, and is it the *same*
   product as "Kilo for Slack," or a separate SKU? (Needed for Phase 7.)
3. Confirm CodeRabbit's actual webhook payload shape against the account you
   already have, rather than the general docs summary. (Needed for Phase 3.)
4. Confirm Manus's webhook payload shape the same way. (Needed for Phase 7.)

## 3. Current state (baseline, verified 2026-07-21/22)

- Telegram is the only chat surface. `telegramCommands.ts` is the single
  command router: ~50 flat `/sentinel <subcommand>` commands (see full
  inventory below), plus inline-keyboard callback handling
  (`handleCallbackQuery`) and free-text AI routing via `telegramAI.ts`.
- Command handling is split across `commands/agents.ts`, `commands/repoOps.ts`,
  `commands/reports.ts`, `commands/sprint.ts` (thin router pattern from the
  June 2026 refactor — see `full_bug_scan_done` / `publishing_plan_progress`
  memory).
- Agent roster today is a fixed list of AI models dispatched internally:
  `nvidia, qwen_coder, qwen_coder_dash, llama_fast, gemini, qwen_max,
  qwen_turbo, deepseek, qwen_plus, opencode` (`KNOWN_AGENT_IDS` in
  `telegramCommands.ts`, backed by `agentDb.ts`).
- Auto-approval today is rule-based and Telegram-triggered: `autoApprover.ts`
  handles sprint auto-approval on a timer (BullMQ-backed since the 2026-07-19
  pass-1 bug fix — see `full_bug_scan_done` memory), not agent-judgment-based.
- Repo → Telegram topic mapping is a hardcoded `TOPIC_MAP` in
  `telegramClient.ts`, keyed by repo name, sourced from per-repo env vars
  (`TOPIC_PROJECT_SENTINEL`, `TOPIC_ACC`, etc.) — 11 repos currently mapped.
- Security scanning: `securityScanner.ts` / `securityPatcher.ts` — no external
  SAST tool wired in yet.
- Audit pipeline: `claudeCodeAudit.ts` → `auditOrchestrator.ts` →
  `audit_tasks` DB table → Notion sync (`auditTaskWriter.ts`) → Telegram
  notification with inline approve/skip buttons.

Everything below is additive/refactor against this baseline — verify each
cited file/function still matches current code before implementing, per the
"memories decay" rule (this section may itself go stale).

## 4. Phase list

| # | Phase | Depends on | Risk |
|---|---|---|---|
| 0 | Unified command layer | — | Low — mechanical refactor |
| 1 | Slack transport (mirror Telegram) | 0 | Medium — new external surface |
| 2 | CodeRabbit code-audit integration | 0, 1 | Medium |
| 3 | Snyk Code + Qodo security integration | 0 | Medium |
| 4 | External Slack-native agent roster (Kilo, Viktor, Devin, Manus, CodeRabbit, extensible) | 0, 1 | Medium — one shared pattern, proven with 2 agents first |
| 5 | Hermes Agent as personal assistant | 1 | Low |
| 6 | Viktor AI delegate-CEO authority | 0, 1, 4's audit-log pattern | **High** |
| 7 | Bloome-style roundtable channel | 1, 4, 6 | Medium |
| 8 | Dust + Zapier (additive glue) | 1 | Low |
| 9 | Codebase-memory MCP server per repo | 4 | Medium — internal side proven, external support unverified per-vendor |

Sequencing note: 2–5 can run in parallel with each other once 0/1 are done;
6 and 7 are intentionally last because they depend on the audit-log and
multi-agent-dispatch patterns proven in earlier phases.

---

## Phase 0 — Unified command layer

**Why first:** every later phase needs to call into commands that aren't
hardcoded to Telegram's `chatId`/`topicId`/inline-keyboard shapes. Building
Slack against the current `telegramCommands.ts` string-router would mean
re-parsing Slack's payload shape into fake Telegram shapes — throwaway work.

### Current command inventory (from `telegramCommands.ts` help text, verify
against `commands/*.ts` source before treating as exhaustive)

- **REPORTS:** `report`, `weekly`, `ceo`, `costs`, `health`, `velocity`,
  `patterns`, `business <repo>`, `impact <repo>`, `roi`
- **AGENTS:** `agents`, `what`, `standup`, `leaderboard`, `bots`, `test-bots`,
  `setup-bots`, `memory`
- **REPOS:** `audit <repo>`, `tasks <repo>`, `execute <repo>`,
  `force-execute <repo>`, `stop <repo>`, `skip <repo>`,
  `skip-batch <repo> <n>`, `lock <repo>`, `unlock <repo>`, `locked`,
  `repo <name>`, `repos`, `repos scan`, `dashboard`
- **SPRINT:** `propose-sprint`, `approve-sprint`, `run-sprint`,
  `sprint-status`, `skip-sprint`, `pause-sprint`, `resume-sprint`, `approve`
- **SECURITY:** `security`, `security <repo>`, `security-scan <repo>`,
  `security-patch <repo>`, `security-approve <repo>`
- **SYSTEM:** `pause`, `resume`, `self-audit`, `self-approve`, `status <repo>`,
  `builds <repo>`, `performance`, `prompts`, `brain`, `check-builder`,
  `sync-metrics`, `menu`, `help`

**Open question — not yet answered by you:** the new namespacing scheme (e.g.
`/sentinel repo audit <x>` vs `/sentinel audit <x>`). You flagged this needs
discussion; **do not implement a specific renaming without a follow-up
decision from you.** This document assumes the *mechanism* (a shared registry)
ships in Phase 0, and the *renaming* itself is a separate decision to make
before or during Phase 0's implementation, not something to guess here.

### File-level changes

- **New:** `backend/src/commandRegistry.ts` — defines `CommandContext`:
  ```ts
  interface CommandContext {
    platform: 'telegram' | 'slack';
    chatId: string;          // Telegram chat id or Slack channel id
    threadId: string | null; // Telegram topic id or Slack thread_ts
    userId: string;
    userName: string;
    reply(text: string, opts?: { buttons?: Button[] }): Promise<void>;
  }
  type CommandHandler = (args: string[], ctx: CommandContext) => Promise<boolean>;
  ```
  and a `registerCommand(name, handler)` / `dispatchCommand(name, args, ctx)`
  pair replacing the current `if (await handleXCmd(...)) return true` chain.
- **Modify:** `commands/agents.ts`, `commands/repoOps.ts`, `commands/reports.ts`,
  `commands/sprint.ts` — change signatures from
  `(subcommand, parts, chatId: string, topicId: number|null)` to
  `(args, ctx: CommandContext)`.
- **New:** `commands/security.ts` — the security-related commands currently
  live inline in `telegramCommands.ts`'s help text but aren't in their own
  module; verify at implementation time whether they're already handled by
  `repoOps.ts` or need extraction.
- **New:** `commands/system.ts` — same treatment for `pause`, `resume`,
  `self-audit`, etc.
- **Modify:** `telegramCommands.ts` — becomes a thin adapter: parse Telegram's
  message/callback shape into a `CommandContext`, call `dispatchCommand`.
  Inline-keyboard callback handling (`handleCallbackQuery`) stays
  Telegram-specific for now (Slack's interactive-component model is different
  enough — see Phase 1) but should call the *same underlying action
  functions* (`triggerAudit`, `executeApprovedTasks`, etc.) it already does.
- **New tests:** `commandRegistry.test.ts` — verify dispatch routing;
  extend existing `commands/*.test.ts` (if present — verify) for the new
  signature.

**Exit criteria:** every command in the inventory above still works from
Telegram, routed through `dispatchCommand`; `npm test` green; `npx tsc
--noEmit` clean.

---

## Phase 1 — Slack transport

### Prerequisites (you provide)

- Slack workspace (existing or new) where the app will be installed.
- Create a Slack App at `api.slack.com/apps` → get `SLACK_BOT_TOKEN`
  (`xoxb-...`) and `SLACK_SIGNING_SECRET`.
- **Confirmed (round 3): HTTP Events API**, not Socket Mode — a new public
  route, e.g. `/webhook/slack/events`, alongside the existing GitHub webhook
  route in `api.ts`/`index.ts`. Requires Slack's request-signature
  verification (HMAC using `SLACK_SIGNING_SECRET` — Bolt's built-in
  `ExpressReceiver` handles this, use it rather than hand-rolling
  verification).
- Bot scopes needed (minimum): `chat:write`, `channels:manage` or
  `channels:join` (for auto-creating/joining per-repo channels), `commands`
  (slash commands), `channels:history` (Phase 7 roundtable needs to read
  other bots' replies in-thread).

### File-level changes

- **New dependency:** `@slack/bolt` (backend `package.json`).
- **New:** `backend/src/slackClient.ts` — mirrors `telegramClient.ts`:
  `sendSlackMessage(text, repoName, threadTs, opts)`, Slack Block Kit
  equivalent of Telegram's inline keyboards for approve/skip buttons.
- **New:** `backend/src/slackCommands.ts` — Bolt app setup, slash command
  registration (`/sentinel`), routes text through the same
  `dispatchCommand` from Phase 0.
- **New:** `backend/src/notify.ts` — replaces direct `sendTelegramMessage(...)`
  call sites with a `notify(event)` fan-out that calls both
  `sendTelegramMessage` and `sendSlackMessage`. **This requires an audit of
  every current `sendTelegramMessage` call site** (grep count needed at
  implementation time — likely 15-20+ files based on the earlier `telegram`
  grep hit-count of 53 files, though not all of those call it directly).
- **DB migration:** new table `slack_channels`:
  ```sql
  CREATE TABLE slack_channels (
    repo_name    TEXT PRIMARY KEY,
    channel_id   TEXT NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT now()
  );
  ```
  replacing/parallel to `telegramClient.ts`'s hardcoded `TOPIC_MAP` — this one
  is DB-driven and auto-populated instead of per-repo env vars, since Slack
  channel creation can be automated via API (`conversations.create`) at
  onboarding time, unlike Telegram topics.
- **DB migration:** add `slack_user_id TEXT` column to whichever table holds
  human identity today (**verify** — `settingsDb.ts` or similar; not yet
  confirmed which table holds the Telegram-side identity fields the June 2026
  de-personalization pass scrubbed — see `repoResolver.js`/`repoResolver.ts`).
- **Modify:** `repoOnboarder.ts` — on new-repo onboarding, also call
  `conversations.create` (Slack) to make `#<reponame>` (normalized, no
  `sentinel-` prefix — per round-2 naming decision, section 1.1 item 5) and
  invite both Sentinel's bot and the relevant external agents (Kilo, Manus,
  Devin, CodeRabbit, Viktor — Phase 4) to the channel, storing the result in
  `slack_channels`.
- **New env vars:** `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`,
  `SLACK_APP_TOKEN` (if Socket Mode) — document in `.env.example`.
- **New tests:** `slackClient.test.ts`, `notify.test.ts` (fan-out logic).

**Exit criteria:** `/sentinel repo audit <repo>` works identically from Slack
and Telegram; a security alert posts to both; a new repo onboarding creates
its Slack channel automatically.

---

## Phase 2 — CodeRabbit becomes the primary audit engine (webhook-invoked —
**flagged by owner as "needs development," i.e. this section is a starting
draft, not a settled design**)

**Access:** you already have a CodeRabbit account. **Research needed at
implementation start:** pull the real webhook payload shape from your
account settings/docs rather than trusting the general docs summary in
section 2's table.

**Confirmed (round 2, still true): Option B.** CodeRabbit replaces
`claudeCodeAudit.ts` as the primary audit engine, for **both Slack and
Telegram** notification paths. Sentinel's own Claude-based auditor is
demoted to fallback/business-impact-scoring support.

**Corrected (round 3): invocation is via CodeRabbit's webhook, not
`@mention`.** This makes CodeRabbit the one agent in the whole roster that
uses a direct API/webhook integration rather than Slack orchestration —
everyone else (Kilo, Viktor, Devin, Manus) is `@mention`-only. Rationale per
your correction: CodeRabbit's job (react to every PR automatically) fits a
push webhook better than a bot needing to be summoned. Because this makes
CodeRabbit structurally different from the rest of the roster, treat it as
its own small subsystem rather than forcing it through Phase 4's shared
`ExternalAgent`/`@mention` dispatch pattern.

**Confirmed (round 3): CodeRabbit already auto-reviews via its own GitHub
App**, independent of Sentinel. This significantly narrows Phase 2's scope —
**Sentinel does not need to trigger CodeRabbit at all.** Phase 2 is purely a
*receiver*: catch CodeRabbit's completion webhook, normalize findings into
`audit_tasks`, and let the existing notification/approval pipeline take it
from there. No dispatch logic, no `webhook/processPREvent.ts` changes needed
for triggering (that file may still need a small change so it *stops*
calling `claudeCodeAudit.ts` as primary — see transition plan below).

**Confirmed (round 3): `claudeCodeAudit.ts` becomes fallback-only.** It only
runs if CodeRabbit's webhook doesn't land within a timeout (**value TBD**,
e.g. reuse whatever pattern the existing build-status polling uses, or a
flat 30-60 min window since CodeRabbit reviews aren't typically instant).

### File-level changes

- **New:** `backend/src/webhook/processCodeRabbitEvent.ts` — receives
  CodeRabbit's PR-review-complete webhook, normalizes findings into the
  `audit_tasks` shape (verify exact schema in `auditDb.ts`).
- **New route:** in `api.ts`, a `/webhook/coderabbit` endpoint (parallel to
  the existing GitHub webhook route — verify exact path in `index.ts`). This
  needs to be registered with CodeRabbit's GitHub App / dashboard settings
  (your account) so it actually fires this endpoint.
- **Modify:** `auditOrchestrator.ts` — CodeRabbit's findings become the
  primary input to `audit_tasks`. Add a fallback timer: if no CodeRabbit
  webhook arrives for a given PR within the timeout window,
  `claudeCodeAudit.ts` runs as a substitute (reuse BullMQ-backed scheduling,
  same durable pattern already used for other timeout-driven jobs per the
  2026-07-19 bug-scan fixes — **do not reintroduce a bare `setTimeout`**,
  that was the exact class of bug fixed twice already in this codebase).
- **New DB column:** `audit_tasks.source TEXT DEFAULT 'coderabbit'` — tags
  each task's origin (`'coderabbit'` | `'sentinel-fallback'`).
- **New tests:** `processCodeRabbitEvent.test.ts`, a fallback-timeout test in
  `auditOrchestrator.test.ts` (known gap per `publishing_plan_progress`
  memory — this closes it with a concrete, useful case).

**Confirmed (round 4): every audit posts a comprehensive-but-brief summary to
the repo's own Slack channel** — not just an approve/skip prompt. "Brief" and
"comprehensive" together means: a short structured summary (finding count by
severity, top 3-5 issues by impact, overall verdict) with a link/expand path
to full detail (Notion page or a Slack thread reply with the complete list),
not a wall of text in the main channel message. This applies to every audit
regardless of source (`coderabbit` or `sentinel-fallback`) — same summary
format either way, so you get a consistent read regardless of which engine
ran.

- **New:** `backend/src/auditSummaryFormatter.ts` — takes a completed audit's
  `audit_tasks` rows and produces the brief-summary text + a
  detail-expansion path (Slack thread reply, or a Notion link — reuse
  whatever `auditTaskWriter.ts` already produces for Notion sync rather than
  building a second formatter).
- Reused by both the CodeRabbit path (this phase) and the fallback
  `claudeCodeAudit.ts` path, and by Telegram's existing audit notification
  (replacing whatever ad-hoc formatting `auditOrchestrator.ts` currently
  does for the Telegram message — verify at implementation time) so both
  platforms show the same shape of summary.

**Exit criteria:** a real PR gets reviewed by CodeRabbit's own GitHub App,
its completion webhook lands on `/webhook/coderabbit`, findings are parsed
into `audit_tasks` with `source = 'coderabbit'`, a comprehensive-but-brief
summary posts to the repo's Slack channel (with working expand-to-detail),
the same shape of summary appears in Telegram, and a simulated
CodeRabbit-webhook-never-arrives case correctly falls back to
`claudeCodeAudit.ts` with `source = 'sentinel-fallback'` and an identically
formatted summary.

---

## Phase 3 — Snyk Code + Qodo (phased, Snyk first)

### Snyk Code

- **Research needed:** confirm you have/will get a Snyk API token; Snyk Code
  has a documented REST API (`api.snyk.io`) for triggering scans and pulling
  results — needs a real token to verify request/response shape.
- **File-level:**
  - **New:** `backend/src/snykClient.ts` — wraps Snyk's scan-trigger and
    results-fetch endpoints.
  - **Modify:** `securityScanner.ts` — add Snyk as a finding source, same
    normalization + `source` tagging pattern as Phase 2's CodeRabbit
    integration (reuse the pattern, don't reinvent it).
  - **New DB column:** `security_findings.source` (verify actual table name
    in `securityScanner.ts`/`securityDb.ts` — referenced as
    `getPortfolioSecuritySummary` in `telegramCommands.ts`, table name itself
    not yet confirmed).
  - **New env var:** `SNYK_API_TOKEN`.
  - **New tests:** `snykClient.test.ts`.

### Qodo (second, once Snyk pattern is proven)

- **Research needed:** Qodo's API surface (test-generation + PR-review) —
  not researched yet in this document; do so when Phase 3 starts.
- **File-level:** same pattern — `qodoClient.ts`, wire into
  `securityScanner.ts` or a new `testCoverageChecker.ts` if Qodo's
  test-generation angle doesn't fit the security-finding shape.

**Exit criteria:** `/sentinel security scan <repo>` output includes
Snyk-sourced findings with correct severity/dedup; Qodo repeats the same
bar once started.

---

## Phase 4 — External Slack-native agent roster (Kilo, Viktor, Devin, Manus,
CodeRabbit, and future additions)

**Confirmed (round 2):** this is one generic mechanism, not five bespoke
integrations. Every agent in `external_agents` (section 1.4's table) is
dispatched the same way — `@mention` in the repo's Slack channel — and
results come back the same way — Sentinel watches the thread. Kilo's CLI and
Manus's/CodeRabbit's webhook APIs are **not** being used (per round-2
decision #1) — noted only so nobody re-proposes them later without a reason.

### Shared: `ExternalAgent` dispatch pattern

```ts
interface ExternalAgent {
  id: string;                  // matches external_agents.id
  slackMention: string;        // '@Kilo', '@manus', '@Viktor', '@Devin', '@coderabbit'
  dispatch(task: AgentTask, ctx: { repoChannelId: string }): Promise<{ threadTs: string }>;
  // Sentinel posts `${slackMention} <task description>` into the repo channel,
  // gets back a thread_ts, and a watcher (see below) correlates later replies
  // in that thread back to the originating task.
}
```

- **New:** `backend/src/agents/externalAgentRegistry.ts` — loads
  `external_agents` from DB, exposes `dispatch(agentId, task, ctx)` using the
  interface above. This is the single dispatch entry point every specific
  agent (Kilo, Viktor, Devin, Manus, CodeRabbit) goes through — **no
  per-agent files needed** unless a specific agent turns out to need special
  reply-parsing logic (likely, since each bot formats its replies
  differently) — in that case, a small `agents/parsers/<agentId>.ts` per
  agent for *parsing only*, not dispatch.
- **New:** `backend/src/agents/threadWatcher.ts` — Slack Events API listener
  (or polling, if Socket Mode event coverage doesn't include messages from
  other bots by default — **verify this at implementation time**, some Slack
  event subscriptions exclude bot-authored messages unless explicitly
  configured) that watches channels with pending dispatches, correlates
  replies to open tasks via `thread_ts`, and feeds parsed results into the
  existing task/sprint completion path (`agentDb.ts`, sprint tracking).
- **Migration:** seed `external_agents` with the five confirmed agents at
  implementation time (`kilo`, `viktor`, `devin`, `manus`, `coderabbit`),
  each with `role` set appropriately (`worker` for Kilo/Manus/Devin,
  `auditor` for CodeRabbit, `authority` for Viktor — matching Phase 2's and
  Phase 6's roles for the latter two).
- Internal AI-model roster (`KNOWN_AGENT_IDS`/`agentDb.ts`) is **untouched**
  by this phase — external agents are additive, dispatched through a
  different mechanism, not merged into the internal roster (per round-2
  decision — see section 1.4).

**Exit criteria:** a task can be assigned to any agent row in
`external_agents` (starting with Kilo and Manus as the first two proven end
to end) via the shared dispatch path, its Slack reply is captured by
`threadWatcher.ts`, and completion is reflected in sprint tracking — proving
the *pattern* works generically, not just for one hardcoded agent.

---

## Phase 5 — Hermes Agent as personal assistant

- Hermes exposes an OpenAI-compatible endpoint (`/v1/chat/completions`),
  confirmed via its own docs (`hermes-agent.nousresearch.com`) — this is a
  standard API integration, not a Slack-native bot, so it's lower-risk than
  Phases 4/6.
- **Resolved (round 5, my call):** hosted Hermes endpoint, not self-hosted —
  avoids taking on model-hosting/uptime/scaling ops for one assistant
  feature (revisit only if hosted cost/rate limits become a real problem).
  Placement: a **dedicated `#hermes` channel**, not a DM — keeps it
  auditable/inspectable, consistent with this plan's general audit-trail
  bias (Phase 6 especially).
- **File-level:**
  - **New:** `backend/src/hermesClient.ts` — thin OpenAI-SDK-compatible
    wrapper pointed at Hermes's hosted endpoint (`HERMES_API_URL`,
    `HERMES_API_KEY` env vars).
  - **New:** `#hermes` Slack channel where Hermes is the only responder,
    distinct from task-worker agent channels — persistent memory is
    per-conversation on Hermes's side, so keeping it to one channel
    preserves continuity.
  - **New command:** routed outside the normal command-registry tree
    entirely — free-text in the `#hermes` channel goes straight to
    `hermesClient`, same pattern as `telegramAI.ts`'s free-text routing.

**Exit criteria:** a free-text message in the Hermes channel gets a
Hermes-generated reply, and a follow-up message in the same
channel/thread demonstrates retained context.

---

## Phase 6 — Viktor AI delegate-CEO authority (highest risk — needs a design
sub-pass before code)

This is the riskiest phase in the whole plan: you asked for **"full delegate
— runs the show while you're away."** That is a real authority grant, not a
notification feature. Do not start writing code for this phase until the
following are answered, either by you or by inspecting your actual Viktor
account:

1. **What can Viktor see?** Read access to `ceoReport.ts`/`sentinelBrain.ts`
   output only, or broader DB access (portfolio metrics, security scores,
   sprint backlog)?
2. **What can Viktor actually trigger, mechanically?** Since Viktor's
   confirmed integration surface is "lives in Slack, 3,200+ OAuth
   integrations, can build custom integrations on the fly" — the likely real
   mechanism is: **Viktor is invited into Sentinel's Slack workspace as a
   member, and Sentinel's own bot watches for Viktor's messages/approvals in
   specific channels/threads**, the same pattern as Manus/Kilo dispatch, but
   inverted — Viktor is *initiating* actions Sentinel executes, not the other
   way around.
3. **Audit trail (non-negotiable):** every Viktor-initiated action needs a
   row in a new `agent_authority_log` table: `{ actor: 'viktor', action,
   target_repo, decision, reasoning, timestamp, reverted_by_human: bool }`.
   Surfaced via a new command (`/sentinel viktor-log` or similar — **name
   TBD, don't guess**).
4. **Bounded authority, not blanket:** reuse `autoApprover.ts`'s existing
   rule-based-approval pattern as the *permission boundary* — Viktor's
   Slack-message-triggered actions only execute if they fall within
   configured limits (e.g., "approve sprints under N tasks," "approve
   security patches tagged safe," never "force-push," never "delete a repo").
   This needs an explicit allow-list design, not an implicit trust-everything
   model.
5. **Kill switch:** `pause` (renamed, section 1.3 — was `/sentinel pause`)
   must also immediately stop Sentinel from acting on any further
   Viktor-originated messages — verify `pause`'s current implementation
   actually gates *all* execution paths, not just scheduled jobs, before
   assuming this "just works."

**Confirmed (round 4): Viktor can be `@mention`ed by other bots, and can
`@mention` other bots itself** — this resolves the earlier open question
about bot-to-bot mentionability (was blocking Phase 6 start). Practical
implication: Viktor isn't just a message-watcher target for Sentinel's own
bot — it can *itself* initiate a roundtable-style fan-out (Phase 7) by
mentioning Kilo/Manus/Devin/CodeRabbit directly, meaning Viktor's "runs the
show while you're away" authority extends to orchestrating the other agents,
not just approving Sentinel's own pre-built task list. This raises the
allow-list design bar in point 4 above — the permission boundary needs to
cover "which agents Viktor is allowed to delegate to and for what," not only
"which Sentinel actions Viktor can approve."

### File-level changes (draft — expect this to change after the design
sub-pass above)

- **New DB migration:** `agent_authority_log` table (schema above).
- **New:** `backend/src/agents/viktorWatcher.ts` — Slack event listener
  scoped to messages from Viktor's bot user ID, parses intent, checks against
  the allow-list, executes via existing orchestrator functions
  (`approveSprint`, `executeApprovedTasks`, etc. — same functions
  Telegram's inline-keyboard callbacks already call, per Phase 0's design
  goal of one action layer under multiple front doors).
- **New:** `backend/src/viktorAuthority.ts` — the allow-list/permission-check
  logic, DB-backed (follow `settingsDb.ts`'s existing pattern). Draft schema
  (round 5 sketch, refine at implementation time):
  ```sql
  CREATE TABLE viktor_authority (
    id               SERIAL PRIMARY KEY,
    action_type      TEXT NOT NULL,      -- 'sprint_approve' | 'security_patch' | 'delegate' | ...
    max_scope        JSONB,              -- e.g. { "max_tasks": 10 } for sprint_approve
    can_delegate_to  TEXT[],             -- subset of external_agents.id — only for action_type='delegate'
    enabled          BOOLEAN DEFAULT true
  );
  ```
  Every Viktor-initiated delegation (per round 4's confirmed bidirectional
  mention capability) is checked against `can_delegate_to` before Sentinel
  lets the delegated agent's dispatch proceed, and logged to
  `agent_authority_log` with `action: 'delegate'`, `target_agent`.
- **New command:** view/audit Viktor's recent decisions (exact name TBD).

**Exit criteria:** Viktor approves a real sprint end-to-end via Slack; the
`agent_authority_log` shows the full decision trail; triggering `/sentinel
pause` mid-flow demonstrably stops a Viktor-initiated action from completing
(test this with a deliberately slow/delayed task, not just a fast one that
might finish before pause propagates).

---

## Phase 7 — Bloome-style "roundtable" — per-repo, mention-triggered

**Synthesis model (per your answer):** Sentinel's own Claude does the
synthesis — not Viktor, not manual.

**Confirmed (round 2): roundtable is per-repo, not global**, and lives in
that repo's existing `#<reponame>` channel (no separate roundtable channel —
consistent with the round-2 naming decision of one channel per repo, not a
proliferation of special-purpose channels). It's triggered by `@mention`
inside that channel — exact trigger phrase still open (e.g. `@sentinel
roundtable <question>` vs a dedicated emoji-reaction trigger vs something
else) — **part of the still-open command-taxonomy design session**, not
decided here.

### Design

- Flow: a human (or Sentinel itself, e.g. from a sprint-planning trigger)
  `@mention`s Sentinel's bot with a roundtable request in the repo's channel.
  Sentinel fans it out by `@mention`-ing the configured set of agents for
  that repo (subset of `external_agents`, e.g. Kilo + Manus + Devin for "how
  should we approach this," or + CodeRabbit for "review this approach," +
  Viktor for a strategic read) in the same thread.
- Sentinel watches the thread (`threadWatcher.ts` from Phase 4 — reused, not
  rebuilt) for each mentioned agent's reply, with a **confirmed 5-minute
  per-agent timeout** before treating it as "no response."
- Once all replies land (or timeout), a new Claude call (reusing
  `claudeCodeAudit.ts`'s or `sentinelBrain.ts`'s LLM-calling pattern —
  **check both for the closest fit** before writing a third one) reads all
  responses and posts a synthesis: agreement points, disagreements, and a
  recommended path, back into the same thread. This synthesis step should
  also call `updateRepoContext(...)` (section 1.2's living-document design)
  so the outcome becomes part of that repo's persistent Notion/`CONTEXT.md`
  context for future dispatches.

### File-level changes

- **New:** `backend/src/agents/roundtable.ts` — orchestrates fan-out (using
  `externalAgentRegistry.ts` from Phase 4), reply collection (via
  `threadWatcher.ts`, reused), timeout handling, and the synthesis call.
- **New DB table:** `roundtable_sessions`
  `{ id, repo_name, question, agents_asked, agents_responded, synthesis,
  created_at }` — `repo_name` is required (per round-2: no global
  roundtable), used both for history/analytics and as the "have we asked
  something like this before, for this repo" lookup (section 1.2's
  roundtable-memory layer).
- **New trigger:** `@mention`-based inside the repo's `#<reponame>` channel —
  exact phrase/pattern is part of the open command-taxonomy session (section
  1.3/1.1 item 4), not fixed here.

**Exit criteria:** `@mention`-ing a roundtable request in a repo's channel
fans out to at least 2 real agents, both replies are captured, a synthesized
summary posts back correctly attributing each agent's stance, a
`roundtable_sessions` row is written, and the repo's living context
doc (Notion + `CONTEXT.md`) reflects the outcome.

---

## Phase 8 — Dust + Zapier (additive, lower priority)

- **Dust:** likely a *consumer* of Sentinel's existing reports (CEO report,
  weekly business report) rather than something Sentinel calls into —
  confirm this framing with you before designing further; not enough detail
  gathered yet to plan file-level changes.
- **Zapier:** glue for whatever isn't worth custom-building. No specific
  trigger identified yet — **needs a concrete use case from you** before this
  phase can be scoped past "we'll use it if something comes up."

This phase is intentionally under-specified — revisit once Phases 0-7 are
underway and a real gap appears that Dust/Zapier would fill.

---

## Phase 9 — Codebase-memory MCP server per repo (confirmed round 4)

**Motivation (your framing):** every agent — Sentinel's internal AI-model
pool *and* the external Slack-native roster (Kilo, Viktor, Devin, Manus,
CodeRabbit) — currently either re-reads a repo from scratch on every
dispatch, or (for external agents) has whatever native repo-understanding
their own product provides, disconnected from Sentinel's accumulated
knowledge of that repo. A shared, graph-indexed codebase-memory layer,
exposed as an MCP server, lets any MCP-capable agent query structure
(symbols, call graphs, architecture) instead of cold-reading files — the
same category of tool this planning conversation itself is using
(`codebase-memory-mcp`) to explore Project Sentinel's own code.

**Confirmed (round 4): build for internal and external agents together**, not
staged — accepting that external-agent MCP support is unverified per vendor
until tested.

### Design

- **Per-repo index:** each onboarded repo gets indexed (structure, symbols,
  call graphs — same category of capability as the `codebase-memory-mcp`
  tool already available in this environment) — verify whether that's a
  reusable hosted service Sentinel can call into, or whether Sentinel needs
  to run/embed an equivalent indexer itself. **This is a real build-or-reuse
  decision, not assumed here** — needs research into what's actually
  available (self-hostable graph-code-indexing MCP servers exist as an open
  category; a specific product choice hasn't been made).
- **Exposure:** the index is served as an MCP server endpoint, one per repo
  or one server with per-repo scoping — **your call, not decided here**.
- **Internal agent wiring:** Sentinel's own dispatch to internal AI-model
  agents (`agentDb.ts`/`KNOWN_AGENT_IDS`) includes this MCP server in the
  agent's available-tools list — this is the low-risk, guaranteed-to-work
  side since it's the same pattern already proven in this very conversation.
- **External agent wiring (per-agent, unverified until tested):** for each
  of Kilo/Viktor/Devin/Manus/CodeRabbit, check whether their product exposes
  a "connect a custom MCP server" setting. If yes, point it at the relevant
  repo's MCP endpoint during onboarding (`repoOnboarder.ts`). If no, that
  agent falls back to reading the living context document (Phase, section
  1.2) instead — not a hard blocker, just a lower-fidelity fallback per
  agent.
- **Onboarding integration:** `repoOnboarder.ts` gains a step: index the new
  repo, register/expose its MCP endpoint, attempt to wire each
  MCP-capable external agent to it (best-effort, log which agents
  succeeded/were skipped).

**Open research items (do not build against assumptions):**
1. What indexing/MCP-serving technology Sentinel actually stands up — reuse
   an existing open-source graph-code-memory MCP server, or build a thin one
   — needs a real evaluation pass, not a guess.
2. Per external agent (Kilo, Viktor, Devin, Manus, CodeRabbit): does its
   product support custom/user-added MCP servers at all? This needs to be
   checked one-by-one against each product's actual settings — this document
   should not assume any of them do or don't until verified.

**Exit criteria:** a real internal agent dispatch demonstrably uses the
per-repo MCP server (e.g. answers a structural question about the repo
without re-reading raw files); for each external agent, either a confirmed
working MCP connection or a confirmed "not supported, falls back to
CONTEXT.md" determination is recorded — no external agent is left
unverified/assumed.

---

## Appendix — Slack app ecosystem beyond MCP (noted, not scoped)

You raised the broader point that Slack's larger app/integration ecosystem
(beyond MCP specifically — Jira, Linear, PagerDuty, etc.) is available in a
way Telegram's isn't. Agreed this is worth using, but it's explicitly **not
scoped in this document** beyond this note — there's no concrete use case
yet (same status as Phase 8's Dust/Zapier). Revisit once Phase 1 ships and a
real integration need surfaces (e.g. "audit findings should also create a
Jira ticket") rather than pre-building generic app-connector plumbing with no
consumer.

---

## 5. Cross-cutting open questions (blocking items, need your answers before
or during the relevant phase — not guessed in this document)

**Resolved across rounds 2-3** (kept here for traceability — full detail in
each phase's section):
- ~~CodeRabbit boundary~~ → Option B (primary engine), invoked via its own
  GitHub App + webhook (not `@mention`, the one exception in the roster).
- ~~`claudeCodeAudit.ts` transition~~ → fallback-only, timeout-triggered.
- ~~Manus/roster invocation~~ → `@mention` only (except CodeRabbit).
- ~~Roundtable scope~~ → per-repo, in the repo's own channel.
- ~~Roundtable timeout~~ → 5 minutes per agent.
- ~~Socket Mode vs HTTP Events API~~ → HTTP Events API, new
  `/webhook/slack/events` route.
- ~~Command prefix~~ → `/sentinel` prefix dropped; verb-first commands
  (`audit <repo>`, not `/sentinel audit <repo>`), AI-routed.
- ~~Per-repo context storage~~ → living document (Notion + `CONTEXT.md`), not
  a raw DB log, updated after every audit/sprint/decision.
- ~~Kilo CLI vs Slack relationship~~ → confirmed same account/agent core,
  shared credits, different licensing (CLI open-source, Slack paid hosted) —
  factual note only, doesn't change the Slack-mention-only build decision.
- ~~Command taxonomy~~ → full canonical rename list written (section 1.3).
- ~~Viktor bot-to-bot mentionability~~ → confirmed both directions work,
  no live-account check needed for this specific point (Phase 6 unblocked
  on this item, though other Phase 6 items remain open below).

**Resolved in round 5 (autonomous — owner said "keep going, no stopping,"
decisions below are my calls, flagged as such, revisit if wrong):**

1. ~~Interaction mechanism per command~~ → **resolved (my call):** default
   every command to `@mention` natural language as the primary path (lowest
   friction, consistent with the rest of the roster) with slash-command
   equivalents auto-generated from the same registry as an always-available
   precise fallback (good for scripting/automation, e.g. a cron-triggered
   `security scan <repo>` from `scheduledJobsWorker.ts` shouldn't depend on
   AI interpretation succeeding). Buttons apply specifically to the existing
   approve/skip/menu-navigation flows (`telegramMenus.ts`'s current scope,
   ported as-is). Modals apply only where a command genuinely needs
   structured multi-field input — scanning the rename list, only
   `skip <repo> batch <n>` and `repo <name>` (control panel entry point)
   plausibly benefit; everything else is fine as plain text args. **Not
   worth a dedicated design session** — this is a small enough decision to
   just build and adjust if a specific command turns out to feel wrong in
   practice.
2. **Resolved (my call):** use `message.channels` + `app_mention` event
   subscriptions, and explicitly request bot-message visibility (Slack's
   Events API excludes a Slack app's own messages by default via the
   `bot_id` check, but does **not** exclude *other* apps' bot messages
   unless the receiving app filters for it itself) — so `threadWatcher.ts`
   (Phase 4) must NOT filter out `bot_id`-tagged messages, only filter out
   messages from Sentinel's *own* bot user ID (to avoid reacting to its own
   posts). This is a concrete implementation instruction now, not an open
   question — still worth a smoke test in Phase 1 to confirm against real
   Slack behavior before relying on it.
3. **Resolved (my call):** hosted Hermes endpoint, not self-hosted — Sentinel
   already runs on Railway without GPU/inference infra, and standing up a
   self-hosted Hermes instance is a meaningfully bigger operational
   commitment (model hosting, uptime, scaling) than everything else in this
   plan, which is all "call someone else's hosted thing." Revisit
   self-hosting only if hosted-endpoint cost or rate limits become a real
   problem. **Channel vs DM: channel** (`#hermes` or similar, not DM) — a
   channel is inspectable/auditable the way a DM to a bot isn't, consistent
   with this whole plan's audit-trail bias (Phase 6 especially).
4. **Resolved (design sketch, my call):** extend Phase 6's
   `viktorAuthority.ts` allow-list schema to include a `can_delegate_to:
   string[]` field (subset of `external_agents.id`) alongside the existing
   action-approval limits — Viktor can only `@mention`-delegate to agents
   explicitly listed there, and every delegated mention still writes to
   `agent_authority_log` (Phase 6) with `actor: 'viktor'`, `action:
   'delegate'`, `target_agent`. This is a sketch, not final — real design
   still happens at Phase 6 implementation time, but it's no longer a blank
   slate.
5. ~~`CONTEXT.md` git-write mechanism~~ → **resolved, verified against actual
   code:** `securityPatcher.ts` already has a proven clone/commit/push
   pattern using `simple-git` (confirmed via direct code read,
   2026-07-22 — `import simpleGit from 'simple-git'`, used for
   `npm audit fix` commits). Reuse this exact pattern for
   `repoContextDoc.ts`'s `CONTEXT.md` commits rather than building a new git
   helper — this was a real unknown, now closed with certainty, not a guess.
6. **Confirmed round 6: stays unscoped for now.** No concrete use case yet —
   revisit when Phase 8 actually starts and a real trigger exists, per your
   explicit choice.
7. **Still open — genuinely requires external research/account access I
   don't have** (checking each vendor's actual settings pages). Not
   resolved autonomously; flagged as the literal first task when Phase 9
   starts.

## 5.1 Suggestions for improvement (round 5, my own additions — not asked
for by name, but gaps I noticed while re-reading the whole plan)

1. **Cost/budget visibility (confirmed round 6: tracking only, no automatic
   cap for now).** Kilo, Viktor, Manus, Devin are all paid products with
   their own credit/usage systems (confirmed for Kilo in round 3's
   fact-check). Extend `costTracker.ts`/the renamed `costs` command to also
   log external-agent dispatch counts per agent per day (Sentinel won't have
   visibility into each vendor's actual credit cost, so this is a dispatch
   *count*, not a dollar figure) — surfaced in the existing reports so
   spend-adjacent activity is visible before it becomes a problem. No
   automatic circuit breaker for now, per your call — revisit if usage
   volume becomes a real concern once the roster is actually live.
2. **Consolidate audit trails.** Phase 6 designs `agent_authority_log`
   specifically for Viktor's decisions. Suggest broadening it (rename to
   `external_agent_actions` or similar) to log **every** dispatch to **any**
   external agent — not just Viktor-initiated ones — with the same shape
   (`actor`, `action`, `target_repo`, `target_agent`, `timestamp`). This
   gives one place to answer "what did the whole external roster do this
   week," useful for debugging a bad Kilo PR or a CodeRabbit false-positive
   just as much as for auditing Viktor.
3. **Least-privilege repo access per external agent, checked explicitly, not
   assumed.** Several of these agents (Kilo, Devin, Manus) can open PRs
   directly against your repos. Before wiring any of them into a real repo
   channel, confirm each one's GitHub App installation is scoped to only the
   repos it should touch (not "all repos" by default) — this is a config
   check on your end (GitHub App settings per vendor), not a code change,
   but worth stating explicitly as a pre-flight step per agent rather than
   assuming default scoping is safe.
4. **Stage the rollout on one repo first, not all 11 — confirmed round 6:
   `costpilot`, not `project-sentinel`.** Your reasoning, and it's correct:
   `project-sentinel` is where I'm already doing the work in this
   conversation, so it's not a clean test of "does an external agent operate
   independently on a repo" — there'd be overlap/confusion between my own
   edits and the roster's. `costpilot` is a real independent repo (already
   has a Telegram topic mapped — `TOPIC_COSTPILOT` in `telegramClient.ts`)
   and makes a genuine proving ground. Every phase's exit criteria should be
   demonstrated against `costpilot` before rolling the corresponding
   channel/agent wiring out to the other 10 repos.
5. **Confirmed round 6: build directly in the real Slack workspace, no
   sandbox.** Noted your call — just flagging the practical implication: if
   Phase 1's initial event-subscription/token setup has a hiccup, it'll be
   debugged live in the workspace the rest of the system will also depend
   on. Not a blocker, just worth going in with that expectation rather than
   being surprised by it.

## 6. Suggested next action

The lowest-risk next step is still **Phase 0**, but it now cannot be
considered complete without open question #1's dedicated command-taxonomy
design session — recommend scheduling that next, before writing any Phase 0
code, since the verb-first syntax decision already made needs the actual
verb list nailed down to implement `dispatchCommand`'s matching logic.

Phase 2 (CodeRabbit) is now the cheapest phase to start in parallel with
Phase 0's design session — CodeRabbit already auto-reviews via its GitHub
App, so Phase 2 is a self-contained webhook-receiver build with no
dependency on Slack (Phase 1) or the command layer (Phase 0) being done
first, only on `/webhook/coderabbit` existing and CodeRabbit's dashboard
being pointed at it.

Phase 6 (Viktor) should still not start until open question #4 is checked
against your live Viktor account.
