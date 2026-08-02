import { safeFire, fireAndForget } from './utils/safeFire';
import logger from './logger';
import { callAnyProvider } from './ai/client';
import { repoFullName } from './repoResolver';
import { validateBrainOutput } from './aiOutputValidator';
import { getPortfolioSummary, REPO_LIST } from './portfolioAnalytics';
import { getOpenPatterns, getDailyCost, getMonthlyCost, getAllLatestMetrics } from './portfolioDb';
import { sendTelegramMessage } from './telegramClient';
import { executeApprovedTasks } from './auditOrchestrator';
import { isRepoLocked } from './repoLock';
import { query } from './dbClient';
import type { BrainDecision } from './types/brainDecision';
import { ensureProject, recordEvent, upsertDecision, upsertKpi } from './boardroomDb';

const BRAIN_MODEL = (process.env['CHAT_MODEL'] as string) || 'mistralai/mistral-nemotron';

interface RepoState {
  repo: string;
  health: string;
  status: string;
  priority: string;
  queued: number;
  safe: number;
  avgRoi: string;
  doneWeek: number;
}

interface TrackRecordEntry {
  timesFocused: number;
  avgHealthDelta: number;
}

interface Intelligence {
  repoStates: RepoState[];
  patterns: string[];
  dailyCost: string;
  monthlyCost: string;
  monthlyBudget: number;
  avgHealth: string;
  brokenRepos: string[];
  prevFocus: string[];
  trackRecord: Record<string, TrackRecordEntry>;
}

interface TaskMapEntry {
  queued: number;
  safe: number;
  avgRoi: string;
  doneWeek: number;
}

const BRAIN_SYSTEM = `You are the strategic brain of Project Sentinel — an autonomous DevOps AI managing 12 GitHub repos for a solo founder named Shayan.

Each morning you receive a full portfolio intelligence briefing and make ONE clear strategic decision for the day.

Respond with valid JSON only — no markdown, no explanation outside the JSON:
{
  "focus_repos": ["repoName1", "repoName2"],
  "action": "execute" | "audit" | "monitor",
  "auto_execute": true | false,
  "reasoning": "2-3 sentences max — direct and specific",
  "daily_goal": "one concrete measurable goal",
  "alerts": ["critical item if any"],
  "skip_repos": ["repos to leave alone today"]
}

DECISION RULES:
1. focus_repos: 1-3 repos max. Broken builds (health < 4) always first.
2. auto_execute: true only if safe queued tasks exist AND health < 8 AND no active agents on that repo.
3. action=execute: run queued safe tasks. action=audit: trigger fresh code audit. action=monitor: just watch.
4. If monthly cost > 80% of $30 budget → be conservative, prefer monitor.
5. Never repeat the same focus_repo two days in a row unless it's still broken.
6. Be decisive. Shayan is busy. One sharp plan beats hedging.
7. Check TRACK RECORD before choosing an action. If a repo has been focused
   3+ times with an average health delta near zero or negative, "execute"
   again on the same kind of task probably won't help — prefer action=audit
   instead (the queued tasks may be the wrong fix) and say so plainly in
   reasoning. A repo with no track record yet, or a clearly positive one,
   is not held to this — proceed normally.`;

async function initBrainSchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS brain_decisions (
      id            SERIAL PRIMARY KEY,
      decided_at    TIMESTAMPTZ DEFAULT NOW(),
      context       JSONB,
      decision      JSONB,
      actions_taken JSONB DEFAULT '[]',
      health_before JSONB,
      health_after  JSONB,
      outcome       JSONB
    )
  `);
}

async function snapshotHealth(): Promise<Record<string, number>> {
  const metrics = await getAllLatestMetrics().catch(() => []);
  const snap: Record<string, number> = {};
  for (const m of metrics) snap[m.repo_name] = parseFloat(m.health_score || '5');
  return snap;
}

async function gatherIntelligence(): Promise<Intelligence> {
  const [summary, patterns, dailyCost, monthlyCost] = await Promise.all([
    getPortfolioSummary().catch(() => null),
    getOpenPatterns().catch(() => []),
    getDailyCost().catch(() => 0),
    getMonthlyCost().catch(() => 0),
  ]);

  interface TaskAggRow {
    repo_full_name: string;
    queued: string;
    safe: string;
    avg_roi: string | null;
    done_week: string;
  }
  const taskRows = await query<TaskAggRow>(`
    SELECT
      at.repo_full_name,
      COUNT(*)  FILTER (WHERE at.status = 'queued')                                     AS queued,
      COUNT(*)  FILTER (WHERE at.status = 'queued' AND at.safe_to_auto_execute = true)   AS safe,
      AVG(trs.final_score) FILTER (WHERE at.status = 'queued')                           AS avg_roi,
      COUNT(*)  FILTER (WHERE at.status = 'done' AND at.updated_at > NOW() - INTERVAL '7 days') AS done_week
    FROM audit_tasks at
    LEFT JOIN task_roi_scores trs ON trs.audit_task_id = at.id
    GROUP BY at.repo_full_name
  `).catch(() => ({ rows: [] as TaskAggRow[] }));

  const taskMap: Record<string, TaskMapEntry> = {};
  for (const r of taskRows.rows) {
    const shortName = r.repo_full_name.split('/')[1];
    if (!shortName) continue;
    taskMap[shortName] = {
      queued:   parseInt(r.queued   || '0'),
      safe:     parseInt(r.safe     || '0'),
      avgRoi:   parseFloat(r.avg_roi || '0').toFixed(1),
      doneWeek: parseInt(r.done_week || '0'),
    };
  }

  const prev = await query<{ decision: BrainDecision }>(`
    SELECT decision FROM brain_decisions
    WHERE decided_at > NOW() - INTERVAL '28 hours'
    ORDER BY decided_at DESC LIMIT 1
  `).catch(() => null);
  const prevFocus = prev?.rows?.[0]?.decision?.focus_repos || [];

  // Feedback loop — recordBrainOutcome() has always computed a health delta
  // per past decision, but nothing ever read it back into the next day's
  // decision. Without this, the brain re-derives a strategy from scratch
  // every day off current metrics alone and never learns whether focusing
  // on a repo actually helped. Pull the last 20 decisions that have a
  // completed outcome and aggregate per-repo: how many times has this repo
  // been focused, and did health actually move when it was?
  interface BrainHistoryRow {
    decision: BrainDecision;
    outcome: { avgHealthDelta: number } | null;
  }
  const history = await query<BrainHistoryRow>(`
    SELECT decision, outcome FROM brain_decisions
    WHERE outcome IS NOT NULL
    ORDER BY decided_at DESC LIMIT 20
  `).catch(() => ({ rows: [] as BrainHistoryRow[] }));

  const deltasByRepo: Record<string, number[]> = {};
  for (const row of history.rows) {
    const focusRepos: string[] = row.decision?.focus_repos || [];
    const delta = parseFloat(String(row.outcome?.avgHealthDelta));
    if (!focusRepos.length || Number.isNaN(delta)) continue;
    for (const repo of focusRepos) {
      (deltasByRepo[repo] ||= []).push(delta);
    }
  }
  const trackRecord: Record<string, { timesFocused: number; avgHealthDelta: number }> = {};
  for (const [repo, deltas] of Object.entries(deltasByRepo)) {
    trackRecord[repo] = {
      timesFocused: deltas.length,
      avgHealthDelta: parseFloat((deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(2)),
    };
  }

  const repoStates: RepoState[] = (summary?.metrics || []).map((m) => {
    const t: TaskMapEntry = taskMap[m.repo_name] || { queued: 0, safe: 0, avgRoi: '0', doneWeek: 0 };
    return {
      repo:     m.repo_name,
      health:   parseFloat(m.health_score || '5').toFixed(1),
      status:   m.build_status || 'unknown',
      priority: m.priority || 'medium',
      queued:   t.queued   || 0,
      safe:     t.safe     || 0,
      avgRoi:   t.avgRoi   || '0',
      doneWeek: t.doneWeek || 0,
    };
  });

  return {
    repoStates,
    patterns:     patterns.slice(0, 5).map((p) => p.description || ''),
    dailyCost:    parseFloat(String(dailyCost)).toFixed(2),
    monthlyCost:  parseFloat(String(monthlyCost)).toFixed(2),
    monthlyBudget: 30,
    avgHealth:    summary?.avgHealth || 'N/A',
    brokenRepos:  (summary?.broken || []).map((m) => m.repo_name),
    prevFocus,
    trackRecord,
  };
}

async function callBrainAI(intelligence: Intelligence): Promise<string> {
  const repoLines = intelligence.repoStates
    .sort((a, b) => parseFloat(a.health) - parseFloat(b.health))
    .map((r) =>
      `${r.repo}: health=${r.health}/10 build=${r.status} queued=${r.queued}(${r.safe} safe) roi=${r.avgRoi} done_week=${r.doneWeek}`
    ).join('\n');

  const trackRecordLines = Object.entries(intelligence.trackRecord || {})
    .map(([repo, t]) =>
      `${repo}: focused ${t.timesFocused}x before, avg health delta ${t.avgHealthDelta >= 0 ? '+' : ''}${t.avgHealthDelta}`
    ).join('\n');

  const prompt = `PORTFOLIO INTELLIGENCE — ${new Date().toDateString()}

Health avg: ${intelligence.avgHealth}/10
Broken: ${intelligence.brokenRepos.join(', ') || 'none'}
Cost: $${intelligence.dailyCost} today / $${intelligence.monthlyCost} of $${intelligence.monthlyBudget} this month

REPOS (sorted by health, worst first):
${repoLines}

PATTERNS:
${intelligence.patterns.join('\n') || 'none detected'}

TRACK RECORD (health delta from your past focus decisions on these repos — this is your only feedback on whether focusing actually helped; use it):
${trackRecordLines || 'no completed outcomes yet'}

Yesterday focused on: ${intelligence.prevFocus.join(', ') || 'nothing'}

Make your strategic decision.`;

  return callAnyProvider({
    userPrompt:   prompt,
    systemPrompt: BRAIN_SYSTEM,
    maxTokens:    500,
    temperature:  0.2,
    models:       { nvidia: BRAIN_MODEL, gemini: 'gemini-2.5-pro' },
  });
}

async function runStrategicBrain(topicId?: number | null): Promise<void> {
  logger.info('Sentinel brain: gathering intelligence');

  try {
    await initBrainSchema();

    const [intelligence, healthBefore] = await Promise.all([
      gatherIntelligence(),
      snapshotHealth(),
    ]);

    const raw = await callBrainAI(intelligence);
    let decision: BrainDecision;
    try {
      const cleaned = raw
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/```json?|```/g, '')
        .trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      decision = validateBrainOutput(JSON.parse(jsonMatch ? jsonMatch[0] : cleaned));
    } catch (parseErr: any) {
      logger.warn({ raw, err: parseErr.message }, 'Brain returned invalid output — skipping execution');
      await safeFire(sendTelegramMessage(`🧠 Brain error — ${parseErr.message}. Check logs.`, null, topicId), { label: 'sentinelBrain' })
      return;
    }

    logger.info({ decision }, 'Brain decision');
    for (const repoName of decision.focus_repos || []) { await ensureProject({ repoFullName: repoName, repoName, displayName: repoName, currentPhase: decision.action || 'monitor', lastActivityAt: new Date().toISOString() }).catch(() => null); }

    const autoEnabled   = process.env['BRAIN_AUTO_EXECUTE'] !== 'false';
    interface ActionTaken { repo: string; skipped?: string; action?: string; }
    const actionsTaken: ActionTaken[]  = [];

    if (decision.auto_execute && autoEnabled && decision.action === 'execute') {
      for (const repoName of (decision.focus_repos || [])) {
        const entry  = REPO_LIST.find((r) => r.repoName === repoName)
          || { repoName, repoFullName: repoFullName(repoName) };
        const locked = await isRepoLocked(repoName).catch(() => null);
        if (locked) {
          actionsTaken.push({ repo: repoName, skipped: 'locked' });
          continue;
        }
        executeApprovedTasks(entry.repoFullName, entry.repoName, topicId ?? null)
          .catch((err: any) => logger.warn({ err: err.message, repo: repoName }, 'Brain execute failed'));
        actionsTaken.push({ repo: repoName, action: 'execute_triggered' });
      }
    }

    await query(`
      INSERT INTO brain_decisions (context, decision, actions_taken, health_before)
      VALUES ($1, $2, $3, $4)
    `, [
      JSON.stringify(intelligence),
      JSON.stringify(decision),
      JSON.stringify(actionsTaken),
      JSON.stringify(healthBefore),
    ]) .catch((err: any) => logger.warn({ err: err.message }, 'Brain DB save failed'));
    for (const repoName of decision.focus_repos || []) { await upsertDecision({ projectId: repoName, title: `Daily brain decision for ${repoName}`, decision: decision.daily_goal || decision.action || 'monitor', rationale: decision.reasoning || null, decidedBy: 'sentinel-brain', source: 'sentinelBrain' }).catch(() => null); await recordEvent({ projectId: repoName, eventType: 'decision_recorded', sourceSystem: 'sentinelBrain', sourceRef: new Date().toISOString(), payload: decision as unknown as Record<string, unknown> }).catch(() => null); }

    const lines = [
      `🧠 Sentinel Brain — ${new Date().toLocaleDateString('en-CA')}`,
      ``,
      `Focus: ${(decision.focus_repos || []).join(', ') || 'nothing today'}`,
      `Action: ${decision.action || 'monitor'}`,
      ``,
      `Goal: ${decision.daily_goal || 'Maintain portfolio health'}`,
      ``,
      decision.reasoning || '',
    ];

    if ((decision.alerts?.length ?? 0) > 0) {
      lines.push(``, `⚠️ Alerts:`);
      decision.alerts?.forEach((a: string) => lines.push(`  · ${a}`));
    }

    if (actionsTaken.filter((a) => a.action).length > 0) {
      lines.push(``, `▶️ Auto-executing: ${actionsTaken.filter((a) => a.action).map((a) => a.repo).join(', ')}`);
    } else if (decision.auto_execute && !autoEnabled) {
      lines.push(``, `⏸ Auto-execute off — set BRAIN_AUTO_EXECUTE=true in Railway to enable.`);
    }

    await safeFire(sendTelegramMessage(lines.filter((l: string | null) => l !== null).join('\n'), null, topicId), { label: 'sentinelBrain' })
    logger.info({ focusRepos: decision.focus_repos, actionsTaken }, 'Brain strategy sent');

  } catch (err: any) {
    logger.error({ err: err.stack ?? err.message }, 'Strategic brain failed');
    await safeFire(sendTelegramMessage(
      `🧠 Sentinel Brain — Error\n\n${err.message}`, null, topicId
    ), { label: 'sentinelBrain' })
  }
}

async function recordBrainOutcome(): Promise<void> {
  try {
    const row = await query<{ id: number; health_before: Record<string, number>; decision: BrainDecision }>(`
      SELECT id, health_before, decision
      FROM brain_decisions
      WHERE decided_at > NOW() - INTERVAL '28 hours'
        AND health_after IS NULL
      ORDER BY decided_at DESC LIMIT 1
    `).catch(() => null);

    if (!row?.rows?.[0]) return;

    const rec         = row.rows[0];
    const healthAfter = await snapshotHealth();
    const before      = rec.health_before || {};
    const focusRepos  = rec.decision?.focus_repos || [];

    let total = 0, count = 0;
    for (const repo of focusRepos) {
      if (before[repo] != null && healthAfter[repo] != null) {
        total += healthAfter[repo] - before[repo];
        count++;
      }
    }
    // Normalize to a number at write time — toFixed(2) returns a string,
    // which previously made the persisted avgHealthDelta a string|number
    // union depending on whether count was 0, contradicting the
    // BrainHistoryRow type (avgHealthDelta: number) that reads it back.
    const avgDelta = count > 0 ? Number((total / count).toFixed(2)) : 0;

    await query(`
      UPDATE brain_decisions
      SET health_after = $1, outcome = $2
      WHERE id = $3
    `, [JSON.stringify(healthAfter), JSON.stringify({ avgHealthDelta: avgDelta, focusRepos }), rec.id])
      .catch((err: any) => logger.warn({ err: err.message }, 'Brain outcome save failed'));

    logger.info({ avgDelta, focusRepos }, 'Brain outcome recorded');
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Brain outcome recording failed');
  }
}

export = { runStrategicBrain, recordBrainOutcome, initBrainSchema };

