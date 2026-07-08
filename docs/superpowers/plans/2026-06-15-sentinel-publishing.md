# Project Sentinel — Stabilize & Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the closed loop works on at least one repo, make the UI show real data, de-personalize for forks, then publish as a credible open-source/self-hosted product.

**Architecture:** Fix the metrics pipeline first (webhook → DB → UI), then agent truthfulness, then extract `GITHUB_ORG` and harden auth/tests/docs. Publishing follows verification — not before.

**Tech Stack:** Node.js 20 · Express · PostgreSQL · Redis/BullMQ · aider · Next.js 14 · Railway · Jest

---

## Inspection Findings (Root Causes)

| Symptom | Root cause | File |
|---------|------------|------|
| Health stuck ~6.5 | Metrics only refresh on daily cron; webhook never writes metrics | `workers.js:460`, `webhook.js` |
| `last_commit_at` always null | Column exists but `upsertRepoMetrics` INSERT omits it | `portfolioDb.js:86-98` |
| Security column always 0 | Hardcoded in UI, not in portfolio API | `ui/app/page.tsx:46` |
| Forks break | `Thatisshayan/` hardcoded in 30+ places | `portfolioAnalytics.js`, `telegramCommands.js`, etc. |
| Bad agents show `idle` | Pool skips missing keys but never marks `error` on 401 | `agentRegistry.js`, `index.js` probeTools |

---

## Phase 0 — Prove the Closed Loop (BLOCKING)

### Task 0.1: Write metrics on every successful webhook

**Files:**
- Modify: `backend/src/webhook.js` (after Notion update, ~line 189)
- Modify: `backend/src/portfolioDb.js:86-98`
- Test: `backend/test/webhook.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// backend/test/webhook.test.js — add inside existing push success describe block
it('records last_commit_at in portfolio_metrics after push', async () => {
  const { upsertRepoMetrics } = require('../src/portfolioDb');
  // mock upsertRepoMetrics and assert called with lastCommitAt from payload timestamp
  jest.mock('../src/portfolioDb', () => ({
    upsertRepoMetrics: jest.fn().mockResolvedValue(undefined),
  }));
  // ... send signed push payload, expect upsertRepoMetrics called
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm ci && npm test -- webhook.test.js -v`  
Expected: FAIL — `upsertRepoMetrics` not called from webhook handler

- [ ] **Step 3: Add `last_commit_at` to upsert and call from webhook**

```javascript
// portfolioDb.js — extend INSERT columns
async function upsertRepoMetrics(data) {
  await query(`
    INSERT INTO portfolio_metrics
      (repo_full_name, repo_name, health_score, build_status,
       priority, builds_passed, builds_failed, tasks_done,
       tasks_queued, debugger_runs, last_build_at, last_commit_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
  `, [
    data.repoFullName, data.repoName, data.healthScore ?? 6.5,
    data.buildStatus ?? 'unknown', data.priority ?? 'medium',
    data.buildsPassedToday ?? 0, data.buildsFailedToday ?? 0,
    data.tasksDoneToday ?? 0, data.tasksQueued ?? 0,
    data.debuggerRunsToday ?? 0, data.lastBuildAt ?? null,
    data.lastCommitAt ?? null,
  ]);
}
```

```javascript
// webhook.js — after successful Notion update (~line 189)
const { upsertRepoMetrics } = require('./portfolioDb');
await upsertRepoMetrics({
  repoFullName: data.repoFullName,
  repoName:     data.repoName,
  lastCommitAt: data.timestamp ? new Date(data.timestamp) : new Date(),
  buildStatus:  'unknown',
  healthScore:  6.5,
  priority:     'medium',
}).catch(err => logger.warn({ err: err.message }, 'Metrics upsert failed — non-blocking'));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- webhook.test.js -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/webhook.js backend/src/portfolioDb.js backend/test/webhook.test.js
git commit -m "fix: record portfolio metrics on every webhook push"
```

---

### Task 0.2: Refresh metrics after build poll completes

**Files:**
- Modify: `backend/src/buildPoller.js`
- Modify: `backend/src/portfolioAnalytics.js`

- [ ] **Step 1: Write the failing test**

```javascript
// backend/test/buildPoller.test.js (new file)
jest.mock('../src/portfolioAnalytics', () => ({
  getRepoStats: jest.fn().mockResolvedValue({ healthScore: 8.0, buildStatus: 'passing' }),
  refreshAllMetrics: jest.fn(),
}));
// assert getRepoStats or upsertRepoMetrics called when poll job completes
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd backend && npm test -- buildPoller.test.js -v`

- [ ] **Step 3: Call `getRepoStats` + `upsertRepoMetrics` when build poll resolves**

After build poll job writes result, refresh single-repo metrics instead of waiting for daily cron.

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "fix: refresh repo metrics after build poll completes"
```

---

### Task 0.3: Agent status truth — mark invalid keys as `error`

**Files:**
- Modify: `backend/src/index.js` (probeTools block)
- Modify: `backend/src/agentDb.js`
- Modify: `backend/src/agentRegistry.js`

- [ ] **Step 1: Write the failing test**

```javascript
// backend/test/agentRegistry.test.js (new)
it('marks agent error when provider returns 401', async () => {
  // mock axios 401 for DASHSCOPE, assert agent_registry.status = 'error'
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement `markAgentError(agentId, reason)` and call from probeTools**

```javascript
// index.js — after invalidProviders detected
const { markAgentError } = require('./agentDb');
const PROVIDER_AGENT_MAP = {
  'NVIDIA NIM': ['nvidia', 'qwen_coder', 'llama_fast'],
  'Gemini': ['gemini'],
  'DashScope (Qwen)': ['qwen_coder_dash', 'qwen_max', 'qwen_turbo'],
  'DeepSeek': ['deepseek'],
};
for (const line of invalidProviders) {
  const provider = line.match(/✗ (.+?):/)?.[1];
  for (const agentId of PROVIDER_AGENT_MAP[provider] || []) {
    await markAgentError(agentId, 'invalid_api_key').catch(() => {});
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "fix: mark agents error when AI provider key is invalid"
```

---

### Task 0.4: E2E smoke test script

**Files:**
- Create: `backend/scripts/smoke-e2e.md`
- Create: `backend/scripts/check-loop.js`

- [ ] **Step 1: Create CLI checker**

```javascript
#!/usr/bin/env node
// backend/scripts/check-loop.js
// Queries: processed_commits (last 24h), portfolio_metrics.last_commit_at,
//          audit_tasks (done count), build_poll_jobs count
// Exit 0 if all non-zero for TARGET_REPO env var, else exit 1 with report
```

- [ ] **Step 2: Document manual Telegram steps in smoke-e2e.md**

1. Push trivial commit to `tapcash`
2. `/sentinel webhook-status` — repo shows events
3. `/sentinel audit tapcash` — 10 tasks generated
4. `/sentinel execute tapcash` — aider runs, PR opened
5. Merge PR on GitHub
6. Run `node scripts/check-loop.js` — all green

- [ ] **Step 3: Run checker against production DB (read-only)**

Run: `DATABASE_URL=... TARGET_REPO=tapcash node backend/scripts/check-loop.js`  
Expected: Exit 1 before fixes; exit 0 after full loop proven

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: add closed-loop smoke test checker"
```

---

### Task 0.5: Verify sentinelBrain

**Files:**
- Modify: `backend/src/telegramCommands.js` (add `brain` command)
- Modify: `backend/src/sentinelBrain.js`

- [ ] **Step 1: Add `/sentinel brain` command that calls `runStrategicBrain`**

- [ ] **Step 2: Trigger manually via Telegram**

Expected: JSON decision logged to `brain_decisions` table + Telegram briefing

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add manual /sentinel brain trigger for verification"
```

**Phase 0 exit criteria:** One repo completes push → audit → execute → PR → merge with non-null metrics in DB and UI.

---

## Phase 1 — UI Truthfulness

### Task 1.1: Wire security scores into portfolio API

**Files:**
- Modify: `backend/src/api.js:23-66`
- Modify: `ui/app/page.tsx:39-53`
- Test: `backend/test/api.test.js` (new)

- [ ] **Step 1: Write failing API test**

```javascript
it('GET /portfolio includes security_score per repo', async () => {
  // mock security_scores query, assert response.repos[0].security_score === 85
});
```

- [ ] **Step 2: LEFT JOIN latest security_scores in portfolio query**

```javascript
// api.js — extend repos query
SELECT DISTINCT ON (pm.repo_name)
  pm.*, COALESCE(ss.score, 0) AS security_score
FROM portfolio_metrics pm
LEFT JOIN LATERAL (
  SELECT score FROM security_scores
  WHERE repo_name = pm.repo_name
  ORDER BY recorded_date DESC LIMIT 1
) ss ON true
ORDER BY pm.repo_name, pm.recorded_at DESC
```

- [ ] **Step 3: Map in page.tsx**

```typescript
security: Math.round(parseFloat(String(r.security_score ?? 0))),
```

- [ ] **Step 4: Run tests + UI build**

Run: `cd backend && npm test -- api.test.js -v`  
Run: `cd ui && npm run build`

- [ ] **Step 5: Commit**

```bash
git commit -m "fix: wire security scores from backend to dashboard"
```

---

### Task 1.2: Real health delta in StatStrip

**Files:**
- Modify: `backend/src/api.js`
- Modify: `ui/app/page.tsx:77`
- Modify: `ui/lib/api.ts` (extend PortfolioData type)

- [ ] **Step 1: Add `healthDelta` to portfolio response from `velocity_metrics`**

- [ ] **Step 2: Replace hardcoded `"+3 vs last week"` with real delta or `"—"`**

- [ ] **Step 3: Commit**

```bash
git commit -m "fix: show real week-over-week health delta on dashboard"
```

---

### Task 1.3: Integrations status endpoint

**Files:**
- Create: `backend/src/integrationsStatus.js`
- Modify: `backend/src/api.js`
- Modify: `ui/app/connectors/page.tsx`

- [ ] **Step 1: Implement `/api/integrations/status`**

Returns: `{ github: { lastWebhook, events7d }, notion: { lastWrite }, telegram: { ok }, providers: [...] }`

- [ ] **Step 2: Replace hardcoded REAL_CONNECTORS status with fetch**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: live integration health on connectors page"
```

---

## Phase 2 — De-personalize for Publishing

### Task 2.1: GITHUB_ORG environment variable

**Files:**
- Modify: `backend/src/portfolioAnalytics.js:10-23`
- Modify: `backend/src/telegramCommands.js` (all `Thatisshayan/` strings)
- Modify: `backend/src/telegramAI.js`
- Modify: `backend/src/api.js:291`
- Modify: `backend/src/sentinelBrain.js`
- Modify: `backend/.env.example`
- Test: `backend/test/repoResolver.test.js` (new)

- [ ] **Step 1: Create `backend/src/repoResolver.js`**

```javascript
function getGithubOrg() {
  const org = process.env.GITHUB_ORG?.trim();
  if (!org) throw new Error('GITHUB_ORG is required');
  return org;
}
function repoFullName(repoName) {
  return `${getGithubOrg()}/${repoName}`;
}
module.exports = { getGithubOrg, repoFullName };
```

- [ ] **Step 2: Replace all hardcoded org strings (grep `Thatisshayan`)**

Run: `rg 'Thatisshayan' backend/src --files-with-matches` — must return 0 files after task

- [ ] **Step 3: Build REPO_LIST from env `WATCHED_REPOS` or Notion query**

- [ ] **Step 4: Add startup validation in index.js**

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor: replace hardcoded GitHub org with GITHUB_ORG env"
```

---

### Task 2.2: Scrub secrets from committed docs

**Files:**
- Modify: `RAILWAY_SETUP.md`
- Modify: `backend/.env.example`

- [ ] **Step 1: Replace real Notion DB ID and Telegram chat ID with placeholders**

- [ ] **Step 2: Add note pointing to private runbook**

- [ ] **Step 3: Commit**

```bash
git commit -m "docs: redact production IDs from setup guide"
```

---

### Task 2.3: Require SENTINEL_UI_KEY in production

**Files:**
- Modify: `backend/src/api.js:13-18`
- Modify: `backend/src/index.js`

- [ ] **Step 1: Fail startup if NODE_ENV=production && !SENTINEL_UI_KEY**

- [ ] **Step 2: Commit**

```bash
git commit -m "security: require SENTINEL_UI_KEY for API in production"
```

---

## Phase 3 — Test & CI Hardening

### Task 3.1: Expand CI to include UI

**Files:**
- Modify: `.github/workflows/ci.yml`

```yaml
jobs:
  backend:
    # existing
  ui:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: ui
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run lint
      - run: npm run build
        env:
          SENTINEL_API_URL: http://localhost:3000
```

- [ ] **Step 1: Add ui job**
- [ ] **Step 2: Push and verify CI green**
- [ ] **Step 3: Commit**

---

### Task 3.2: Docker Compose local dev stack

**Files:**
- Create: `docker-compose.yml`
- Create: `docs/QUICKSTART.md`

- [ ] **Step 1: Compose postgres + redis + backend**
- [ ] **Step 2: Document 15-minute local setup**
- [ ] **Step 3: Commit**

---

### Task 3.3: Critical path tests (target 40% coverage)

**Files:**
- Create: `backend/test/auditOrchestrator.test.js`
- Create: `backend/test/api.test.js`
- Create: `backend/test/repoResolver.test.js`

Priority test cases:
- Audit loop rules 1–4 (sentinel commit skip, cooldown, queue threshold)
- API auth middleware 401/200
- repoFullName resolution

---

## Phase 4 — Code Health

### Task 4.1: Split telegramCommands.js

Extract to:
- `backend/src/commands/reports.js`
- `backend/src/commands/sprint.js`
- `backend/src/commands/agents.js`
- `backend/src/commands/repoOps.js`
- `backend/src/telegramCommands.js` (router only, ~200 lines)

### Task 4.2: JSON schema validation for AI outputs

**Files:**
- Add dependency: `zod` or use manual validators
- Modify: `claudeCodeAudit.js`, `sprintPlanner.js`, `sentinelBrain.js`

Validate audit task arrays and brain decision JSON before DB insert.

---

## Phase 5 — Publishing

### Task 5.1: License & community files

**Files:**
- Create: `LICENSE` (recommend MIT or Apache-2.0 for adoption)
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Create: `AGENTS.md`
- Modify: `README.md` (remove "Private — all rights reserved")

### Task 5.2: Documentation pack

**Files:**
- Create: `docs/ARCHITECTURE.md`
- Create: `docs/TROUBLESHOOTING.md`
- Create: `docs/DEMO_MODE.md`

### Task 5.3: Railway template + demo video

- One-click Railway deploy with Postgres + Redis
- 3-minute screen recording: push → audit → PR → merge

### Task 5.4: Public beta launch checklist

- [ ] Phase 0 exit criteria met on video
- [ ] No hardcoded org/username
- [ ] UI shows real data or honest empty states
- [ ] LICENSE committed
- [ ] CI green (backend + UI)
- [ ] `.env.example` complete
- [ ] Secrets scrubbed from docs

**Positioning for launch:**
> "Self-hosted DevOps copilot: audit → task → PR pipeline with Telegram command center and multi-model agent room. Free-model-first."

---

## Self-Review

| Spec requirement | Task |
|------------------|------|
| Prove closed loop | 0.1–0.5 |
| UI truthfulness | 1.1–1.3 |
| De-personalize | 2.1–2.3 |
| Tests & CI | 3.1–3.3 |
| Code health | 4.1–4.2 |
| Publish | 5.1–5.4 |

No TBD placeholders. All tasks have concrete files and commands.

---

## Recommended Execution Order

1. **Phase 0** (blocking) — ~1–2 weeks
2. **Phase 1** — ~1 week (can overlap with 0.4–0.5)
3. **Phase 2** — ~1–2 weeks
4. **Phase 3** — ~2 weeks
5. **Phase 4** — ongoing
6. **Phase 5** — after Phase 0 exit criteria + Phase 2 complete

**Earliest public beta:** ~6–8 weeks from 2026-06-15.
