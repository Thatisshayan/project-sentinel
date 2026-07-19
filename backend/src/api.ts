import { safeFire, fireAndForget } from './utils/safeFire';
/**
 * Sentinel UI — REST API routes
 * Auth: x-sentinel-key header (SENTINEL_UI_KEY env var)
 * All routes prefixed /api when mounted in index.js
 */

import express from 'express';
import dbClient from './dbClient';
const { query } = dbClient;
import logger from './logger';
import { repoFullName } from './repoResolver';
import { timingSafeEqual } from './utils/timingSafeCompare';
import rateLimit from 'express-rate-limit';

const router = express.Router();

// ── Rate limiting ───────────────────────────────────────────────────────────

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

router.use(apiLimiter);

// ── Auth middleware ───────────────────────────────────────────────────────────

router.use((req: any, res: any, next: any) => {
  const key = process.env['SENTINEL_UI_KEY'];
  const headerKey = req.headers['x-sentinel-key'];
  if (key && (typeof headerKey !== 'string' || !timingSafeEqual(headerKey, key))) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
});

// ── Portfolio overview ────────────────────────────────────────────────────────

router.get('/portfolio', async (req: any, res: any) => {
  try {
    // Latest snapshot per repo. health_score is picked from the most recent
    // row where it is non-null — a null row written at webhook-receipt time
    // (before build data is available) must not mask a previously computed score.
    const repos = await query(`
      SELECT DISTINCT ON (pm.repo_name)
        pm.repo_name, pm.repo_full_name,
        COALESCE(pm.health_score, hs.health_score) AS health_score,
        pm.build_status,
        pm.priority, pm.builds_passed, pm.builds_failed,
        pm.tasks_done, pm.tasks_queued, pm.last_commit_at, pm.last_build_at, pm.recorded_at,
        COALESCE(ss.score, 0) AS security_score
      FROM portfolio_metrics pm
      LEFT JOIN LATERAL (
        SELECT health_score FROM portfolio_metrics
        WHERE repo_name = pm.repo_name AND health_score IS NOT NULL
        ORDER BY recorded_at DESC LIMIT 1
      ) hs ON true
      LEFT JOIN LATERAL (
        SELECT score FROM security_scores
        WHERE repo_name = pm.repo_name
        ORDER BY recorded_date DESC LIMIT 1
      ) ss ON true
      ORDER BY pm.repo_name, pm.recorded_at DESC
    `);

    // Active agents
    const agents = await query(`
      SELECT agent_id, agent_label, repo_full_name, task_id, task_title,
             status, started_at, last_active_at, completed_tasks, failed_tasks
      FROM agent_registry
      ORDER BY last_active_at DESC
    `);

    // Monthly cost
    const cost = await query(`
      SELECT COALESCE(SUM(estimated_cost), 0) AS monthly_cost
      FROM api_costs
      WHERE recorded_at >= date_trunc('month', NOW())
    `);

    // Task counts
    const tasks = await query(`
      SELECT COUNT(*) AS queued
      FROM audit_tasks
      WHERE status IN ('queued','in_progress')
    `);

    // Week-over-week health delta from velocity_metrics
    const velocity = await query(`
      SELECT health_delta FROM velocity_metrics
      ORDER BY week_start DESC LIMIT 1
    `).catch(() => ({ rows: [] }));
    const healthDelta = velocity.rows[0]?.health_delta != null
      ? parseFloat(velocity.rows[0].health_delta)
      : null;

    res.json({
      repos: repos.rows,
      agents: agents.rows,
      monthlyCost: parseFloat(cost.rows[0]?.monthly_cost || 0),
      tasksQueued: parseInt(tasks.rows[0]?.queued || 0),
      healthDelta,
    });
  } catch (err: any) {
    logger.error({ err: err.stack ?? err.message }, 'GET /portfolio error');
    res.status(500).json({ error: err.message });
  }
});

// ── Single repo ───────────────────────────────────────────────────────────────

router.get('/repo/:name', async (req: any, res: any) => {
  try {
    const name = req.params.name;

    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
      res.status(400).json({ error: 'Invalid repo name' });
      return;
    }

    const metrics = await query(`
      SELECT * FROM portfolio_metrics
      WHERE repo_name = $1
      ORDER BY recorded_at DESC LIMIT 1
    `, [name]);

    const tasks = await query(`
      SELECT at.* FROM audit_tasks at
      JOIN audit_cycles ac ON ac.id = at.audit_cycle_id
      WHERE at.repo_full_name LIKE $1
      ORDER BY at.priority ASC, at.task_number ASC
      LIMIT 50
    `, [`%/${name}`]);

    const cycle = await query(`
      SELECT * FROM audit_cycles
      WHERE repo_full_name LIKE $1
      ORDER BY created_at DESC LIMIT 1
    `, [`%/${name}`]);

    if (!metrics.rows[0]) { res.status(404).json({ error: 'Repo not found' }); return; }

    res.json({
      ...metrics.rows[0],
      tasks: tasks.rows,
      lastCycle: cycle.rows[0] || null,
    });
  } catch (err: any) {
    logger.error({ err: err.stack ?? err.message }, 'GET /repo/:name error');
    res.status(500).json({ error: err.message });
  }
});

router.get('/repo/:name/tasks', async (req: any, res: any) => {
  try {
    const name = req.params.name;

    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
      res.status(400).json({ error: 'Invalid repo name' });
      return;
    }

    const r = await query(`
      SELECT at.* FROM audit_tasks at
      JOIN audit_cycles ac ON ac.id = at.audit_cycle_id
      WHERE at.repo_full_name LIKE $1
      ORDER BY at.priority ASC, at.task_number ASC
    `, [`%/${name}`]);
    res.json(r.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Agents ────────────────────────────────────────────────────────────────────

router.get('/agents', async (req: any, res: any) => {
  try {
    const r = await query(`
      SELECT agent_id, agent_label, repo_full_name, task_id, task_title,
             status, started_at, last_active_at, completed_tasks, failed_tasks
      FROM agent_registry
      ORDER BY last_active_at DESC
    `);
    res.json(r.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/agents/:id/toggle', async (req: any, res: any) => {
  try {
    const r = await query(`
      UPDATE agent_registry
      SET status = CASE WHEN status = 'idle' THEN 'paused' ELSE 'idle' END,
          last_active_at = NOW()
      WHERE agent_id = $1
      RETURNING *
    `, [req.params.id]);
    if (!r.rows[0]) { res.status(404).json({ error: 'Agent not found' }); return; }
    res.json(r.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Dashboard command — routes text from UI chat into Sentinel brain ──────────

router.post('/command', async (req: any, res: any) => {
  const { text, fromName = 'Dashboard' } = req.body || {};
  if (!text || typeof text !== 'string') {
    res.status(400).json({ error: 'text required' });
    return;
  }

  // Log the user's message into agent_messages so the UI sees it
  const { logAgentMessage } = require('./agentDb');
  await safeFire(logAgentMessage('dashboard_user', fromName, text, 'info', null), { label: 'api' })

  // Fire command through the real handler (non-blocking — response arrives via agent_messages poll)
  const { handleCommand } = require('./telegramCommands');
  handleCommand(text, null, null, fromName, null).catch((err: any) =>
    logger.warn({ err: err.message }, 'Dashboard command failed')
  );

  res.json({ ok: true });
});

// ── Agent room messages ───────────────────────────────────────────────────────

router.get('/agent-room/messages', async (req: any, res: any) => {
  try {
    const parsedLimit = parseInt(req.query.limit || '50', 10);
    const limit = Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 50, 200);
    const r = await query(`
      SELECT id, agent_id, agent_label, message, message_type, repo_name, created_at
      FROM agent_messages
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);
    res.json(r.rows.reverse()); // chronological order
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sprints ───────────────────────────────────────────────────────────────────

router.get('/sprints/current', async (req: any, res: any) => {
  try {
    const sprint = await query(`
      SELECT * FROM sprints
      WHERE status IN ('approved','executing','proposed')
      ORDER BY week_start DESC LIMIT 1
    `);
    if (!sprint.rows[0]) { res.json(null); return; }

    const tasks = await query(`
      SELECT * FROM sprint_tasks
      WHERE sprint_id = $1
      ORDER BY execution_order ASC
    `, [sprint.rows[0].id]);

    const velocity = await query(`
      SELECT * FROM velocity_metrics
      ORDER BY week_start DESC LIMIT 8
    `);

    res.json({
      sprint: sprint.rows[0],
      tasks: tasks.rows,
      velocity: velocity.rows.reverse(),
    });
  } catch (err: any) {
    logger.error({ err: err.stack ?? err.message }, 'GET /sprints/current error');
    res.status(500).json({ error: err.message });
  }
});

router.post('/sprint/approve', async (req: any, res: any) => {
  try {
    const { sprintId } = req.body;
    const r = await query(`
      UPDATE sprints SET status='approved', approved_at=NOW()
      WHERE id = $1 RETURNING *
    `, [sprintId]);
    if (!r.rows[0]) { res.status(404).json({ error: 'Sprint not found' }); return; }
    res.json(r.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sprint/skip', async (req: any, res: any) => {
  try {
    const { sprintId } = req.body;
    const r = await query(`
      UPDATE sprints SET status='skipped' WHERE id=$1 RETURNING *
    `, [sprintId]);
    res.json(r.rows[0] || {});
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Security ──────────────────────────────────────────────────────────────────

router.get('/security/portfolio', async (req: any, res: any) => {
  try {
    const scores = await query(`
      SELECT DISTINCT ON (repo_name)
        repo_name, score, vulnerabilities, critical_count,
        high_count, medium_count, low_count, recorded_date
      FROM security_scores
      ORDER BY repo_name, recorded_date DESC
    `);

    const issues = await query(`
      SELECT si.*, ss.repo_full_name
      FROM security_issues si
      JOIN security_scans ss ON ss.id = si.scan_id
      WHERE si.status IN ('open','in_progress')
      ORDER BY
        CASE si.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2
          WHEN 'medium' THEN 3 ELSE 4 END,
        si.found_at DESC
      LIMIT 100
    `);

    res.json({ scores: scores.rows, issues: issues.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Builder management ────────────────────────────────────────────────────────

router.post('/system/set-builder', async (req: any, res: any) => {
  try {
    const { repoName, builder } = req.body;
    const { getBuilderConfig } = require('./builderRouter');
    if (!getBuilderConfig(builder)) {
      res.status(400).json({ error: `Unknown builder: ${builder}` });
      return;
    }
    const r = await query(`
      UPDATE audit_tasks SET builder_agent = $1
      WHERE repo_full_name LIKE $2 AND status = 'queued'
      RETURNING id
    `, [builder, `%/${repoName}`]);
    res.json({ ok: true, updated: r.rows.length, builder });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Repo actions ──────────────────────────────────────────────────────────────

router.post('/repo/:name/audit', async (req: any, res: any) => {
  // Respond immediately; audit runs async in background
  res.json({ ok: true, message: `Audit queued for ${req.params.name}` });
  try {
    const { triggerAudit } = require('./auditOrchestrator');
    const name = req.params.name;
    triggerAudit({
      repoFullName:  repoFullName(name),
      repoName:      name,
      projectName:   name,
      commitSha:     `manual-${Date.now()}`,
      commitMessage: '[manual-audit]',
      branchName:    'main',
      authorName:    'Dashboard',
      authorEmail:   '',
      topicId:       null,
    }).catch((err: any) => logger.warn({ err: err.message, name }, 'Dashboard audit failed'));
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Could not start dashboard audit');
  }
});

router.post('/system/audit-all', (req: any, res: any) => {
  const { REPO_LIST }   = require('./portfolioAnalytics');
  const { triggerAudit } = require('./auditOrchestrator');
  const { repoFullName: resolverFullName } = require('./repoResolver');
  res.json({ ok: true, queued: REPO_LIST.length });
  for (const repo of REPO_LIST) {
    triggerAudit({
      repoFullName:  repo.repoFullName,
      repoName:      repo.repoName,
      projectName:   repo.repoName,
      commitSha:     `manual-${Date.now()}`,
      commitMessage: '[bulk-audit]',
      branchName:    'main',
      authorName:    'Dashboard',
      authorEmail:   '',
      topicId:       null,
    }).catch((err: any) => logger.warn({ err: err.message, repo: repo.repoName }, 'Bulk audit item failed'));
  }
});

router.post('/system/security-scan', (req: any, res: any) => {
  const { REPO_LIST }     = require('./portfolioAnalytics');
  const { runSecurityScan } = require('./securityScanner');
  res.json({ ok: true, queued: REPO_LIST.length });
  for (const repo of REPO_LIST) {
    runSecurityScan({
      repoFullName: repo.repoFullName,
      repoName:     repo.repoName,
      commitSha:    'HEAD',
      topicId:      null,
    }).catch((err: any) => logger.warn({ err: err.message, repo: repo.repoName }, 'Bulk scan item failed'));
  }
});

router.post('/security/issue/:id/patch', (req: any, res: any) => {
  res.status(501).json({
    error: 'Not implemented — use Telegram command /sentinel security-patch <repo> to patch issues',
  });
});

router.post('/system/pause', async (req: any, res: any) => {
  try {
    await query(`
      UPDATE agent_registry SET status='paused' WHERE status='idle'
    `);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/system/resume', async (req: any, res: any) => {
  try {
    await query(`
      UPDATE agent_registry SET status='idle' WHERE status='paused'
    `);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Cost data ─────────────────────────────────────────────────────────────────

router.get('/costs', async (req: any, res: any) => {
  try {
    const monthly = await query(`
      SELECT COALESCE(SUM(estimated_cost), 0) AS total
      FROM api_costs
      WHERE recorded_at >= date_trunc('month', NOW())
    `);
    const byRepo = await query(`
      SELECT repo_full_name, SUM(estimated_cost) AS cost
      FROM api_costs
      WHERE recorded_at >= date_trunc('month', NOW())
        AND repo_full_name IS NOT NULL
      GROUP BY repo_full_name
      ORDER BY cost DESC
    `);
    res.json({
      monthly: parseFloat(monthly.rows[0]?.total || 0),
      byRepo: byRepo.rows,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/integrations/status', async (req: any, res: any) => {
  try {
    const { getIntegrationsStatus } = require('./integrationsStatus');
    const status = await getIntegrationsStatus();
    res.json(status);
  } catch (err: any) {
    logger.error({ err: err.stack ?? err.message }, 'GET /integrations/status error');
    res.status(500).json({ error: err.message });
  }
});

// ── Settings ──────────────────────────────────────────────────────────────────

router.get('/settings', async (req: any, res: any) => {
  try {
    const { getSettings } = require('./settingsDb');
    const settings = await getSettings();
    res.json(settings);
  } catch (err: any) {
    logger.error({ err: err.stack ?? err.message }, 'GET /settings error');
    res.status(500).json({ error: err.message });
  }
});

router.post('/settings/update', async (req: any, res: any) => {
  try {
    const { updateSettings } = require('./settingsDb');
    const updated = await updateSettings(req.body);
    res.json(updated);
  } catch (err: any) {
    logger.error({ err: err.stack ?? err.message }, 'POST /settings/update error');
    res.status(500).json({ error: err.message });
  }
});

export = router;

