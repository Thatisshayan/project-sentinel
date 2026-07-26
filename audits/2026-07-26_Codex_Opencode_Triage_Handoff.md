# OpenCode Debug Handoff

Date: 2026-07-26
Scope: Follow-up debugging and remediation for the 2026-07-25 full-repo audit
Source audit: [`audits/2026-07-25_Opencode_FullRepo_Audit.md`](./2026-07-25_Opencode_FullRepo_Audit.md)

## Purpose

This document is the handoff prompt I want OpenCode to follow for the next pass.

Use it as a strict execution brief, not as a loose suggestion.

## Triage Summary

### Confirmed high-priority bugs

1. `H-1` BullMQ repeat jobs are scheduled with fixed `jobId`s in:
   - [`backend/src/workers/dailyReportWorker.ts`](../backend/src/workers/dailyReportWorker.ts)
   - [`backend/src/workers/sprintWorker.ts`](../backend/src/workers/sprintWorker.ts)

   This is the top bug. It can silently stop recurring jobs from continuing correctly across restarts and redeploys.

2. `H-2` Slack message handling in:
   - [`backend/src/slackEvents.ts`](../backend/src/slackEvents.ts)

   The message path does not filter bot/self-authored Slack events before reply correlation and Viktor handling.

3. `H-3` CI supply-chain risk in:
   - [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)

   The OWASP Dependency-Check action is pinned to `@main`.

### Confirmed medium-priority bugs

4. `M-1` PR webhook task matching bug:
   - [`backend/src/webhook/processPREvent.ts`](../backend/src/webhook/processPREvent.ts)

5. `M-2` Roundtable synthesis race:
   - [`backend/src/agents/roundtable.ts`](../backend/src/agents/roundtable.ts)

6. `M-3` Webhook dedup state is in-memory only:
   - [`backend/src/deduplication.ts`](../backend/src/deduplication.ts)
   - [`backend/src/webhook/processWebhook.ts`](../backend/src/webhook/processWebhook.ts)

7. `M-5` Dashboard command path passes `null` where Telegram menu code expects a real chat id:
   - [`backend/src/api.ts`](../backend/src/api.ts)
   - [`backend/src/telegramCommands.ts`](../backend/src/telegramCommands.ts)
   - [`backend/src/telegramMenus.ts`](../backend/src/telegramMenus.ts)

8. `M-6` Weekly audit cron hardcodes `main`:
   - [`backend/src/workers/dailyReportWorker.ts`](../backend/src/workers/dailyReportWorker.ts)

### Lower-priority items that looked real but need confirmation or are mostly doc/process issues

- `M-7` gate workflow / verify script mismatch
- `M-8` Railway setup doc start command mismatch
- `DM-1` ConfirmedBugs.md historical entry mismatch

Do not spend time “fixing” those unless verification shows a real runtime defect or a doc bug that must be updated in the same pass.

## Expected Debugging Standard

OpenCode must not claim fake completeness.

Do not mark the job complete unless:

1. Every confirmed bug has been traced to source.
2. The impact path has been verified with callers or downstream consumers.
3. A smallest safe fix plan has been identified.
4. Tests to add or update have been listed.
5. Any new bug discovered during work has been triaged and either fixed in scope or explicitly logged.

## Required Repo Rules

Follow the repository rules exactly:

- Read [`REPO_RULES.md`](../REPO_RULES.md) and [`AGENTS.md`](../AGENTS.md) before touching anything.
- Branch-only workflow. Do not commit or push to `main`.
- Update docs in the same pass as code.
- Save any audit or follow-up writeups under `audits/` with the required naming convention.
- Record deferred work in `docs/governance/DEFERRED_WORK.md` if something must wait.
- Do not delete files without explicit approval.
- Do not introduce paid API or infra spend without approval.
- Run repository verification before finishing: `bash scripts/verify.sh` or `pwsh scripts/verify.ps1`.

## Recommended Subagent Split

Use subagents aggressively, but keep them isolated by subsystem so they do not step on each other’s files.

Suggested split:

1. Worker / queue / scheduler agent
   - `backend/src/workers/**`
   - `backend/src/queueClient.ts`
   - `backend/src/autoApprover.ts`

2. Slack / roundtable / integration agent
   - `backend/src/slackEvents.ts`
   - `backend/src/agents/roundtable.ts`
   - related Slack client and external-agent files

3. Webhook / PR handling agent
   - `backend/src/webhook/**`
   - `backend/src/deduplication.ts`
   - `backend/src/processWebhook.ts` if present by alias in the tree

4. API / Telegram / dashboard agent
   - `backend/src/api.ts`
   - `backend/src/telegramCommands.ts`
   - `backend/src/telegramMenus.ts`
   - `backend/src/telegramAI.ts`

5. CI / workflow / docs agent
   - `.github/workflows/**`
   - deployment scripts
   - doc mismatches that affect operational correctness

If a subagent encounters a new bug in its subsystem, fix it in that same pass if it is safe and local. If the bug is outside the current subsystem, report it immediately and continue with the assigned scope.

## Fix Order

1. `H-1`
2. `H-2`
3. `H-3`
4. `M-1`
5. `M-2`
6. `M-3`
7. `M-5`
8. `M-6`

## Verification Expectations Per Bug

For each real bug, OpenCode should provide:

- root cause
- exact file and line references
- caller / impact tracing
- smallest safe fix plan
- regression risk
- tests that should be added

For any fix that changes behavior, add or update tests in the same branch.

## Completion Criteria

OpenCode should finish with:

1. A deep triage/fix report.
2. Verified test results.
3. A clean commit on a branch.
4. A push to the branch.
5. No fake “complete” status unless the work is actually done.

## Paste-Ready Prompt For OpenCode

Use the text below as the actual instruction to OpenCode:

---

You are continuing follow-up debugging for `D:\AgentDevWork\repos\project-sentinel`.

Primary source triage: [`audits/2026-07-25_Opencode_FullRepo_Audit.md`](./2026-07-25_Opencode_FullRepo_Audit.md)
This handoff: [`audits/2026-07-26_Codex_Opencode_Triage_Handoff.md`](./2026-07-26_Codex_Opencode_Triage_Handoff.md)

Your task is to debug and remediate the confirmed findings from the audit, starting with the highest-risk issues and working downward in practical subsystem order.

Mandatory rules:

- Read `REPO_RULES.md` and `AGENTS.md` first, and follow them exactly.
- Branch-only workflow. Do not commit or push to `main`.
- Use codebase-memory graph tools for discovery and impact tracing first.
- Verify suspicious findings directly against current source before accepting them.
- Do not claim fake completeness. Do not say “done” unless the work is truly complete.
- Update docs in the same pass as code.
- Save any audit or follow-up documentation under `audits/` using the required naming pattern.
- If a new bug appears while working in a subsystem, fix it if it is local and safe; otherwise log it clearly and continue.
- At the end, provide a deep report with exact file/line references, root cause, impact, fix plan, regression risk, and tests.
- After all fixes and verification are done, create a branch commit and push it.

High-priority bugs to address first:

1. `H-1` BullMQ repeat jobs with constant `jobId`s:
   - `backend/src/workers/dailyReportWorker.ts`
   - `backend/src/workers/sprintWorker.ts`

2. `H-2` Slack bot/self-message filtering:
   - `backend/src/slackEvents.ts`

3. `H-3` Mutable GitHub Action ref:
   - `.github/workflows/ci.yml`

Then handle:

4. `M-1` PR webhook matching:
   - `backend/src/webhook/processPREvent.ts`

5. `M-2` roundtable synthesis race:
   - `backend/src/agents/roundtable.ts`

6. `M-3` webhook dedup state restart gap:
   - `backend/src/deduplication.ts`
   - `backend/src/webhook/processWebhook.ts`

7. `M-5` dashboard command null chat id:
   - `backend/src/api.ts`
   - `backend/src/telegramCommands.ts`
   - `backend/src/telegramMenus.ts`

8. `M-6` weekly-audit hardcoded `main`:
   - `backend/src/workers/dailyReportWorker.ts`

Execution requirements:

- Use multiple subagents where possible.
- Keep subagents isolated by subsystem so they do not touch the same files.
- Do not cut corners.
- Do not report the job as complete until the fixes are verified and tests are run.
- If something is outside the current scope but clearly a real bug, note it and decide whether it belongs in the same branch or should go to `docs/governance/DEFERRED_WORK.md`.

Deliverables:

- a deep triage/fix report
- tests added or updated
- verification output
- a clean commit on a branch
- a push to that branch

---

