import axios from 'axios';
import logger from './logger';
import { repoFullName } from './repoResolver';
import { validateBrainOutput } from './aiOutputValidator';
import { getPortfolioSummary, REPO_LIST } from './portfolioAnalytics';
import { getOpenPatterns, getDailyCost, getMonthlyCost, getAllLatestMetrics } from './portfolioDb';
import { sendTelegramMessage } from './telegramClient';
import { executeApprovedTasks } from './auditOrchestrator';
import { isRepoLocked } from './repoLock';
import { query } from './dbClient';

const BRAIN_MODEL = (process.env['CHAT_MODEL'] as string) || 'mistralai/mistral-nemotron';

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
6. Be decisive. Shayan is busy. One sharp plan beats hedging.`;

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
  for (const m of metrics) snap[m.repo_name] = parseFloat(m.health_score || 5);
  return snap;
}

async function gatherIntelligence(): Promise<any> {
  const [summary, patterns, dailyCost, monthlyCost] = await Promise.all([
    getPortfolioSummary().catch(() => null),
    getOpenPatterns().catch(() => []),
    getDailyCost().catch(() => 0),
    getMonthlyCost().catch(() => 0),
  ]);

  const taskRows = await query(`
    SELECT
      at.repo_full_name,
      COUNT(*)  FILTER (WHERE at.status = 'queued')                                     AS queued,
      COUNT(*)  FILTER (WHERE at.status = 'queued' AND at.safe_to_auto_execute = true)   AS safe,
      AVG(trs.final_score) FILTER (WHERE at.status = 'queued')                           AS avg_roi,
      COUNT(*)  FILTER (WHERE at.status = 'done' AND at.updated_at > NOW() - INTERVAL '7 days') AS done_week
    FROM audit_tasks at
    LEFT JOIN task_roi_scores trs ON trs.audit_task_id = at.id
    GROUP BY at.repo_full_name
  `).catch(() => ({ rows: [] }));

  const taskMap: Record<string, any> = {};
  for (const r of taskRows.rows) {
    taskMap[r.repo_full_name.split('/')[1]] = {
      queued:   parseInt(r.queued   || 0),
      safe:     parseInt(r.safe     || 0),
      avgRoi:   parseFloat(r.avg_roi || 0).toFixed(1),
      doneWeek: parseInt(r.done_week || 0),
    };
  }

  const prev = await query(`
    SELECT decision FROM brain_decisions
    WHERE decided_at > NOW() - INTERVAL '28 hours'
    ORDER BY decided_at DESC LIMIT 1
  `).catch(() => null);
  const prevFocus = prev?.rows?.[0]?.decision?.focus_repos || [];

  const repoStates = (summary?.metrics || []).map((m: any) => {
    const t = taskMap[m.repo_name] || {};
    return {
      repo:     m.repo_name,
      health:   parseFloat(m.health_score || 5).toFixed(1),
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
    patterns:     patterns.slice(0, 5).map((p: any) => p.description),
    dailyCost:    parseFloat(String(dailyCost)).toFixed(2),
    monthlyCost:  parseFloat(String(monthlyCost)).toFixed(2),
    monthlyBudget: 30,
    avgHealth:    summary?.avgHealth || 'N/A',
    brokenRepos:  (summary?.broken || []).map((m: any) => m.repo_name),
    prevFocus,
  };
}

async function callBrainAI(intelligence: any): Promise<string> {
  const repoLines = intelligence.repoStates
    .sort((a: any, b: any) => parseFloat(a.health) - parseFloat(b.health))
    .map((r: any) =>
      `${r.repo}: health=${r.health}/10 build=${r.status} queued=${r.queued}(${r.safe} safe) roi=${r.avgRoi} done_week=${r.doneWeek}`
    ).join('\n');

  const prompt = `PORTFOLIO INTELLIGENCE — ${new Date().toDateString()}

Health avg: ${intelligence.avgHealth}/10
Broken: ${intelligence.brokenRepos.join(', ') || 'none'}
Cost: $${intelligence.dailyCost} today / $${intelligence.monthlyCost} of $${intelligence.monthlyBudget} this month

REPOS (sorted by health, worst first):
${repoLines}

PATTERNS:
${intelligence.patterns.join('\n') || 'none detected'}

Yesterday focused on: ${intelligence.prevFocus.join(', ') || 'nothing'}

Make your strategic decision.`;

  const tryProvider = async (apiKey: string, url: string, model: string): Promise<string> => {
    const res = await axios.post(url,
      { model, messages: [{ role: 'system', content: BRAIN_SYSTEM }, { role: 'user', content: prompt }],
        max_tokens: 500, temperature: 0.2 },
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 30000 }
    );
    return res.data.choices[0]?.message?.content || '';
  };

  const dashscopeBase = process.env['DASHSCOPE_BASE_URL'] || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const providers = [
    { key: process.env['NVIDIA_API_KEY'],   url: 'https://integrate.api.nvidia.com/v1/chat/completions',                     model: BRAIN_MODEL,  name: 'NVIDIA NIM' },
    { key: process.env['GEMINI_API_KEY'],   url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-2.5-pro', name: 'Gemini' },
    { key: process.env['DASHSCOPE_API_KEY'], url: `${dashscopeBase}/chat/completions`,                                      model: 'qwen-max',   name: 'DashScope (Qwen)' },
    { key: process.env['DEEPSEEK_API_KEY'], url: 'https://api.deepseek.com/chat/completions',                               model: 'deepseek-chat', name: 'DeepSeek' },
  ].filter((p: any) => p.key);

  if (providers.length === 0) {
    throw new Error('No AI provider available for brain');
  }

  let lastErr: any;
  for (const p of providers) {
    try {
      return await tryProvider(p.key!, p.url, p.model);
    } catch (err: any) {
      lastErr = err;
      logger.warn({ provider: p.name, err: err.message }, 'Brain provider failed — trying next');
    }
  }
  throw lastErr;
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
    let decision: any;
    try {
      const cleaned = raw
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/```json?|```/g, '')
        .trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      decision = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);
      validateBrainOutput(decision);
    } catch (parseErr: any) {
      logger.warn({ raw, err: parseErr.message }, 'Brain returned invalid output — skipping execution');
      await sendTelegramMessage(`🧠 Brain error — ${parseErr.message}. Check logs.`, null, topicId).catch(() => {});
      return;
    }

    logger.info({ decision }, 'Brain decision');

    const autoEnabled   = process.env['BRAIN_AUTO_EXECUTE'] !== 'false';
    const actionsTaken: any[]  = [];

    if (decision.auto_execute && autoEnabled && decision.action === 'execute') {
      for (const repoName of (decision.focus_repos || [])) {
        const entry  = REPO_LIST.find((r: any) => r.repoName === repoName)
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
    ]).catch((err: any) => logger.warn({ err: err.message }, 'Brain DB save failed'));

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

    if (decision.alerts?.length > 0) {
      lines.push(``, `⚠️ Alerts:`);
      decision.alerts.forEach((a: string) => lines.push(`  · ${a}`));
    }

    if (actionsTaken.filter((a: any) => a.action).length > 0) {
      lines.push(``, `▶️ Auto-executing: ${actionsTaken.filter((a: any) => a.action).map((a: any) => a.repo).join(', ')}`);
    } else if (decision.auto_execute && !autoEnabled) {
      lines.push(``, `⏸ Auto-execute off — set BRAIN_AUTO_EXECUTE=true in Railway to enable.`);
    }

    await sendTelegramMessage(lines.filter((l: string | null) => l !== null).join('\n'), null, topicId).catch(() => {});
    logger.info({ focusRepos: decision.focus_repos, actionsTaken }, 'Brain strategy sent');

  } catch (err: any) {
    logger.error({ err: err.stack ?? err.message }, 'Strategic brain failed');
    await sendTelegramMessage(
      `🧠 Sentinel Brain — Error\n\n${err.message}`, null, topicId
    ).catch(() => {});
  }
}

async function recordBrainOutcome(): Promise<void> {
  try {
    const row = await query(`
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
    const avgDelta = count > 0 ? (total / count).toFixed(2) : 0;

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

