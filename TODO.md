# Sentinel — Open Issues

## P0 — Broken / Actively Wrong

### 1. Agent status is a lie for agents with bad API keys
- Agents with missing or invalid API keys show as `idle` in both Telegram and the UI
- `idle` means "ready and waiting". A broken agent should show `unconfigured` or `error`
- **Fix needed:** On startup (and daily), probe each agent's API key. Mark agent `status = 'error'` if the key returns 401/403. Surface this in `/agents list`, the UI agents page, and the daily report.
- Affected agents likely: DashScope ones (qwen_turbo, qwen_max, qwen_coder_dash) if DASHSCOPE_BASE_URL is wrong, any others with stale keys.

### 2. Health scores are all defaults — no real data flowing in
- Every repo shows `6.5/10` (the hardcoded default) because `last_commit_at`, `builds_passed`, `builds_failed` are all null/0
- This means GitHub webhooks are not being received OR not being stored as repo metrics
- **Fix needed:** Verify GitHub webhook is registered and pointing to the correct backend URL. Check `repo_metrics` table is being written on each webhook event.

### 3. Zero build history across all repos
- `builds_passed: 0`, `builds_failed: 0` for every repo
- Build poll worker fires on webhook push events — if webhooks aren't arriving, no builds get recorded
- **Fix needed:** Same as above (GitHub webhook verification) + confirm `enqueueBuildCheck` is being called on push events.

### 4. Tasks completed = 0 for all agents
- No agent has ever completed or failed a task according to the DB
- Either: tasks are never being executed, or execution isn't writing back to `agent_messages`/`audit_tasks`
- **Fix needed:** Manually trigger one task with `/sentinel force-execute tapcash` via Telegram and verify the full flow runs end to end.

### 5. Security scores all showing 0 in the UI
- `security: 0` hardcoded in `app/page.tsx` (line 46: `security: 0`)
- The backend has a security scanner but the score isn't being pulled into the portfolio API
- **Fix needed:** Add `security_score` to the `/api/portfolio` backend query and map it in `page.tsx`.

---

## P1 — Misleading / Missing

### 6. NL commands in Agent Room — AI says "Acknowledged" for unrecognised patterns
- "Llama work on alphonso", "Nemotron start task for tapcash" → AI echoes back instead of acting
- The SYSTEM_PROMPT triggers don't cover "<agent> work on <repo>" or "start the task for <repo>"
- **Fix needed:** Add NL triggers: `"<agent> work on <repo>"`, `"start the task for <repo>"`, `"<agent name> start <repo>"` → `execute_tasks`

### 7. `/sentinel audit` with no repo arg is confusing
- Returns "Usage: /sentinel audit <repo-name>" — fine, but the Agent Room chip says `/sentinel audit` with no repo
- **Fix needed:** Update chip to `/sentinel audit tapcash` (with a real repo) OR make audit-all work.

### 8. Brain deployed but not verified
- `sentinelBrain.js` wired into workers.js — fires 7am Toronto daily
- Never been run yet — unknown if it actually works end to end
- **Fix needed:** Manually trigger via Telegram: `/sentinel brain` or trigger the job directly. Verify it sends a briefing.

### 9. Railway service arrow / connection visual
- `SENTINEL_API_URL` was set without `${{sentinel-backend.RAILWAY_PUBLIC_DOMAIN}}` reference format
- Railway doesn't show the visual arrow between services without the reference syntax
- **Fix needed:** In Railway → sentinel-ui → Variables → change `SENTINEL_API_URL` to `${{sentinel-backend.RAILWAY_PUBLIC_DOMAIN}}` to restore the visual link (functional already, just cosmetic).

### 10. DashScope international endpoint — verify it's working
- Set `DASHSCOPE_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1` in Railway
- Unknown if the new API key + intl endpoint combination is actually returning 200
- **Fix needed:** Check Railway startup logs for the provider health check result for DashScope.

---

## P2 — Polish / Enhancement

### 11. Sidebar badges should be real counts
- Removed hardcoded badges (12, 8, 27) — now empty
- Should show live counts from DB: repo count, active agent count, open security issues
- **Fix needed:** Make sidebar a server component OR pass counts through a layout data fetch.

### 12. Connectors page — add real health check
- Currently shows GitHub/Telegram/Notion/Railway as "connected" based on hardcoded list
- Should actually ping each integration and show last-seen timestamp from DB
- **Fix needed:** Add `/api/integrations/status` backend endpoint that checks webhook last-received, last Notion write, etc.

### 13. `+3 vs last week` health delta is hardcoded
- `app/page.tsx` line 77: `sub: "+3 vs last week"` — never real
- **Fix needed:** Compare current avg health to `velocity_metrics.avg_health` from last week.

### 14. Budget panel — verify it shows real cost
- `BudgetPanel` component pulls from somewhere — verify it's not hardcoded
- **Fix needed:** Read and confirm the BudgetPanel data source is real.
