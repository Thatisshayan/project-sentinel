# Sentinel — Open Issues

## P0 — Broken / Actively Wrong

### 1. ~~Agent status is a lie for agents with bad API keys~~ — FIXED 2026-06-16
- Startup probe already existed (`backend/src/index.js` `probeTools()`) but only ran once at boot — no daily re-check, so a key that died mid-day stayed silently "idle".
- Extracted the probe into `backend/src/providerHealthCheck.js` (`probeAIProviders`), reused by both startup (`index.js`) and a new daily 5am Toronto cron job (`provider-health` in `backend/src/workers.js`).
- `getAgentRoomSummary()` in `backend/src/agentRoom.js` was bucketing any non-`working` agent (including `error`) as "idle (N done)" — fixed to surface `🔴 ERROR (...)` distinctly and added an Error count to the summary header.
- UI `STATUS_COLOR` map in `ui/components/sentinel/agents-view.tsx` had no `error` entry (fell back to the same muted gray as `idle`) — added `error`/`unconfigured` colors and a red glow line so error agents are visually distinct.

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

### 5. ~~Security scores all showing 0 in the UI~~ — CONFIRMED FIXED
- `ui/app/page.tsx` line 47 maps `security: Math.round(parseFloat(String(r.security_score ?? 0)))` from the real `/api/portfolio` response — no hardcoded 0 remains.

---

## P1 — Misleading / Missing

### 6. ~~NL commands in Agent Room — unrecognised patterns~~ — FIXED 2026-06-16
- Added `"<agent> work on <repo>"`, `"start the task for <repo>"`, `"<agent> start <repo>"` to the NATURAL LANGUAGE TRIGGERS list in `backend/src/telegramAI.js` SYSTEM_PROMPT, mapped to `execute_tasks`.

### 7. ~~`/sentinel audit` chip with no repo arg~~ — CONFIRMED FIXED
- `ui/app/agent-room/page.tsx` line 8 chip already reads `/sentinel audit tapcash` (real repo, matches convention used throughout README/MANUAL/smoke-e2e docs). No change needed.

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

### 11. ~~Sidebar badges should be real counts~~ — FIXED 2026-06-16
- `ui/components/sentinel/sidebar.tsx` NAV badges were all hardcoded `null`. Reused the existing `/api/stats` route (already fetched by Topbar/BudgetPanel) — extended `ui/app/api/stats/route.ts` to also call the backend `/api/security/portfolio` endpoint and return `securityIssueCount`. Sidebar now polls `/api/stats` every 30s and shows: Repos = repo count, Agents = `working/total`, Security = open issue count (hidden when 0).

### 12. ~~Connectors page — real health check~~ — CONFIRMED FIXED
- `backend/src/api.js` `/api/integrations/status` delegates to `backend/src/integrationsStatus.js`; `ui/app/connectors/page.tsx` calls `getIntegrationsStatus()`. Real, not hardcoded.

### 13. ~~`+3 vs last week` health delta hardcoded~~ — CONFIRMED FIXED
- `ui/app/page.tsx` computes `healthDeltaSub` from `portfolio.healthDelta`, sourced from backend `/api/portfolio` query against `velocity_metrics.health_delta` (`backend/src/api.js` lines 65-71). No hardcoded value remains.

### 14. ~~Budget panel — verify real cost~~ — CONFIRMED FIXED
- `ui/components/sentinel/budget-panel.tsx` → `/api/stats` → backend `/api/portfolio` → `monthlyCost: parseFloat(cost.rows[0]?.monthly_cost || 0)` computed via `SUM(estimated_cost) FROM api_costs WHERE recorded_at >= date_trunc('month', NOW())` (`backend/src/api.js` lines 50-55). Real DB-backed cost, not mocked.
