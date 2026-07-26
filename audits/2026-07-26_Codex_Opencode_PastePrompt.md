You are continuing debugging for `D:\AgentDevWork\repos\project-sentinel`.

Start here:
- [`audits/2026-07-25_Opencode_FullRepo_Audit.md`](./2026-07-25_Opencode_FullRepo_Audit.md)
- [`audits/2026-07-26_Codex_Opencode_Triage_Handoff.md`](./2026-07-26_Codex_Opencode_Triage_Handoff.md)

Work only from current source. Verify each finding before accepting it. Do not re-audit the entire repo unless something is clearly missing or contradictory.

Hard rules:
- Read `REPO_RULES.md` and `AGENTS.md` first, then follow them exactly.
- Branch-only workflow. Do not commit or push to `main`.
- Use codebase-memory graph tools first for discovery and impact tracing.
- Use multiple subagents where possible.
- Keep subagents isolated by subsystem so they do not touch the same files.
- Do not claim fake completeness. Do not say “done” unless the work is actually done.
- If a new bug appears while working in scope, fix it if it is local and safe; otherwise log it clearly and continue.
- Update docs in the same pass as code.
- Save any audit/follow-up writeup under `audits/` with the required naming convention.
- Run repository verification before finishing.
- After all fixes and verification, create a branch commit and push it.

Fix order:
1. `H-1` BullMQ repeat jobs with fixed `jobId`s
   - `backend/src/workers/dailyReportWorker.ts`
   - `backend/src/workers/sprintWorker.ts`
2. `H-2` Slack bot/self-message filtering
   - `backend/src/slackEvents.ts`
3. `H-3` Mutable GitHub Action ref
   - `.github/workflows/ci.yml`
4. `M-1` PR webhook matching
   - `backend/src/webhook/processPREvent.ts`
5. `M-2` roundtable synthesis race
   - `backend/src/agents/roundtable.ts`
6. `M-3` webhook dedup is in-memory only
   - `backend/src/deduplication.ts`
   - `backend/src/webhook/processWebhook.ts`
7. `M-5` dashboard command passes `null` chat id
   - `backend/src/api.ts`
   - `backend/src/telegramCommands.ts`
   - `backend/src/telegramMenus.ts`
8. `M-6` weekly audit hardcodes `main`
   - `backend/src/workers/dailyReportWorker.ts`

For each real bug, report:
- root cause
- exact file(s) and line(s)
- caller/impact tracing
- smallest safe fix plan
- regression risk
- tests to add

Completion standard:
- All confirmed bugs above are fixed or explicitly deferred with justification.
- Tests and verification are run.
- Final report is deep, specific, and evidence-based.
- No fake completion claims.

If you need a template for subsystem split, use:
- worker / queue / scheduler subagent
- Slack / roundtable subagent
- webhook / PR handling subagent
- API / Telegram / dashboard subagent
- CI / workflow / docs subagent

