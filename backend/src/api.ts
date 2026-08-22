import { safeFire, fireAndForget } from './utils/safeFire';
/**
 * Sentinel UI — REST API routes
 * Auth: x-sentinel-key header (SENTINEL_UI_KEY env var)
 * All routes prefixed /api when mounted in index.js
 */

import express, { Request, Response, NextFunction } from 'express';
import dbClient from './dbClient';
const { query } = dbClient;
import logger from './logger';
import { repoFullName } from './repoResolver';
import { timingSafeEqual } from './utils/timingSafeCompare';
import rateLimit from 'express-rate-limit';
import projectMemory from './projectMemory';
import projectDb from './projectDb';
import governanceStatus from './governanceStatus';
import { normalizeRepoAutomationPolicy, type RepoAutomationPolicy } from './repoAutomationPolicy';

const MEMORY_TYPES = ['dismissed_finding', 'convention', 'decision', 'note'] as const;
const MAX_MEMORY_CONTENT_LENGTH = 2000;
// getMemoryEntries defaults to 20 (MAX_ENTRIES_IN_PROMPT), tuned for prompt
// injection, not a management UI's full history view — pass an explicit,
// UI-appropriate limit here instead of silently inheriting that cap.
const MEMORY_LIST_LIMIT = 200;

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

router.use((req: Request, res: Response, next: NextFunction) => {
  const key = process.env['SENTINEL_UI_KEY'];
  const headerKey = req.headers['x-sentinel-key'];
  if (key && (typeof headerKey !== 'string' || !timingSafeEqual(headerKey, key))) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
});

// ── Portfolio overview ────────────────────────────────────────────────────────

router.get('/portfolio', async (req: Request, res: Response) => {
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

router.get('/governance/status', async (req: Request, res: Response) => {
  try {
    const status = await governanceStatus.getGovernanceStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Single repo ───────────────────────────────────────────────────────────────

router.get('/repo/:name', async (req: Request, res: Response) => {
  try {
    const name = req.params['name'];

    if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
      res.status(400).json({ error: 'Invalid repo name' });
      return;
    }

    // portfolio_metrics has no security_score column of its own — it's a
    // point-in-time score from security_scores, joined the same way the
    // /portfolio list route does it. Without this join every single-repo
    // response silently reported security_score as undefined/0.
    const metrics = await query(`
      SELECT pm.*, COALESCE(ss.score, 0) AS security_score
      FROM portfolio_metrics pm
      LEFT JOIN LATERAL (
        SELECT score FROM security_scores
        WHERE repo_name = pm.repo_name
        ORDER BY recorded_date DESC LIMIT 1
      ) ss ON true
      WHERE pm.repo_name = $1
      ORDER BY pm.recorded_at DESC LIMIT 1
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

    // getAspectState takes the short repo name (matching what this route
    // already receives) and has no side effect on a miss — unlike
    // auditAspects.getCurrentAspect(), which persists a default aspect
    // state on first call and would be wrong to trigger from a GET.
    const aspect = await projectDb.getAspectState(name);
    const policy = await projectDb.getRepoAutomationPolicy(name);

    res.json({
      ...metrics.rows[0],
      tasks: tasks.rows,
      lastCycle: cycle.rows[0] || null,
      aspect,
      policy,
    });
  } catch (err: any) {
    logger.error({ err: err.stack ?? err.message }, 'GET /repo/:name error');
    res.status(500).json({ error: err.message });
  }
});

// ── Project memory ────────────────────────────────────────────────────────────

function isValidRepoNameParam(name: unknown): name is string {
  return typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name);
}

router.get('/repo/:name/memory', async (req: Request, res: Response) => {
  const name = req.params['name'];
  if (!isValidRepoNameParam(name)) {
    res.status(400).json({ error: 'Invalid repo name' });
    return;
  }
  try {
    const entries = await projectMemory.getMemoryEntries(repoFullName(name), MEMORY_LIST_LIMIT);
    res.json(entries);
  } catch (err: any) {
    logger.error({ err: err.stack ?? err.message }, 'GET /repo/:name/memory error');
    res.status(500).json({ error: err.message });
  }
});

router.post('/repo/:name/memory', async (req: Request, res: Response) => {
  const name = req.params['name'];
  if (!isValidRepoNameParam(name)) {
    res.status(400).json({ error: 'Invalid repo name' });
    return;
  }
  const { type, content } = req.body ?? {};
  if (typeof type !== 'string' || !(MEMORY_TYPES as readonly string[]).includes(type)) {
    res.status(400).json({ error: `type must be one of: ${MEMORY_TYPES.join(', ')}` });
    return;
  }
  if (typeof content !== 'string' || content.trim().length === 0 || content.length > MAX_MEMORY_CONTENT_LENGTH) {
    res.status(400).json({ error: `content must be a non-empty string of at most ${MAX_MEMORY_CONTENT_LENGTH} characters` });
    return;
  }
  try {
    const entry = await projectMemory.addMemoryEntry(repoFullName(name), type as any, content, 'Dashboard');
    res.status(201).json(entry);
  } catch (err: any) {
    logger.error({ err: err.stack ?? err.message }, 'POST /repo/:name/memory error');
    res.status(500).json({ error: err.message });
  }
});

router.post('/repo/:name/policy', async (req: Request, res: Response) => {
  const name = req.params['name'];
  if (!isValidRepoNameParam(name)) {
    res.status(400).json({ error: 'Invalid repo name' });
    return;
  }

  const body = req.body ?? {};
  const policyPatch: Partial<RepoAutomationPolicy> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!['allowTaskExecution', 'allowPrOpen', 'allowPrUpdate', 'allowAutoPush'].includes(key)) {
      res.status(400).json({ error: `Unknown policy field: ${key}` });
      return;
    }
    if (typeof value !== 'boolean') {
      res.status(400).json({ error: `Policy field ${key} must be boolean` });
      return;
    }
    policyPatch[key as keyof RepoAutomationPolicy] = value;
  }

  try {
    const existing = await projectDb.getRepoAutomationPolicy(name);
    const updated = await projectDb.setRepoAutomationPolicy(name, normalizeRepoAutomationPolicy({
      ...existing,
      ...policyPatch,
    }));
    res.json(updated);
  } catch (err: any) {
    logger.error({ err: err.stack ?? err.message }, 'POST /repo/:name/policy error');
    res.status(500).json({ error: err.message });
  }
});

router.delete('/repo/:name/memory/:id', async (req: Request, res: Response) => {
  const name = req.params['name'];
  if (!isValidRepoNameParam(name)) {
    res.status(400).json({ error: 'Invalid repo name' });
    return;
  }
  const id = Number(req.params['id']);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid memory entry id' });
    return;
  }
  try {
    const deleted = await projectMemory.deleteMemoryEntry(repoFullName(name), id);
    if (!deleted) { res.status(404).json({ error: 'Memory entry not found' }); return; }
    res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err: err.stack ?? err.message }, 'DELETE /repo/:name/memory/:id error');
    res.status(500).json({ error: err.message });
  }
});

router.get('/repo/:name/tasks', async (req: Request, res: Response) => {
  try {
    const name = req.params['name'];

    if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
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

// Mirrors the Telegram `task-approve:<id>` callback in telegramCommands.ts —
// same query, same "approve then immediately execute" behavior.
router.post('/task/:id/execute', async (req: Request, res: Response) => {
  const idParam = req.params['id'];
  // parseInt() alone accepts "1abc"/"1.2" and silently truncates to 1 —
  // require the whole param to be digits before converting, so a malformed
  // id 400s instead of silently operating on an unrelated task.
  const id = typeof idParam === 'string' && /^\d+$/.test(idParam) ? parseInt(idParam, 10) : NaN;
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid task id' });
    return;
  }
  try {
    // WHERE status = 'queued' makes this an atomic, idempotent transition —
    // without it, a repeated/racing request (double-click before the UI
    // disables the button, a retried request, a stale tab) could re-trigger
    // executeApprovedTasks() on a task that's already in_progress/done/
    // skipped/failed instead of being a no-op.
    const result = await query(
      `UPDATE audit_tasks SET safe_to_auto_execute = true
       WHERE id = $1 AND status = 'queued'
       RETURNING repo_full_name, task_number, title`,
      [id]
    );
    const row = result.rows[0];
    if (!row) {
      const existing = await query('SELECT status FROM audit_tasks WHERE id = $1', [id]);
      if (!existing.rows[0]) {
        res.status(404).json({ error: 'Task not found' });
      } else {
        res.status(409).json({ error: `Task is already ${existing.rows[0].status} — cannot execute` });
      }
      return;
    }
    res.json({ ok: true, message: `Task #${row.task_number} approved — executing now` });
    const { executeApprovedTasks } = require('./auditOrchestrator');
    const repoName = row.repo_full_name.split('/')[1];
    executeApprovedTasks(row.repo_full_name, repoName, null)
      .catch((err: any) => logger.warn({ err: err.message, id }, 'Dashboard task execute failed'));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Mirrors the Telegram `task-skip:<id>` callback in telegramCommands.ts.
router.post('/task/:id/skip', async (req: Request, res: Response) => {
  const idParam = req.params['id'];
  // parseInt() alone accepts "1abc"/"1.2" and silently truncates to 1 —
  // require the whole param to be digits before converting, so a malformed
  // id 400s instead of silently operating on an unrelated task.
  const id = typeof idParam === 'string' && /^\d+$/.test(idParam) ? parseInt(idParam, 10) : NaN;
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid task id' });
    return;
  }
  try {
    // Same atomicity concern as /execute above — only a still-'queued' task
    // can be skipped, so a stale/racing skip request can't flip an
    // already-executing or already-done task back to 'skipped'.
    const result = await query(
      `UPDATE audit_tasks SET status = 'skipped'
       WHERE id = $1 AND status = 'queued'
       RETURNING task_number`,
      [id]
    );
    const row = result.rows[0];
    if (!row) {
      const existing = await query('SELECT status FROM audit_tasks WHERE id = $1', [id]);
      if (!existing.rows[0]) {
        res.status(404).json({ error: 'Task not found' });
      } else {
        res.status(409).json({ error: `Task is already ${existing.rows[0].status} — cannot skip` });
      }
      return;
    }
    res.json({ ok: true, message: `Task #${row.task_number} skipped` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Agents ────────────────────────────────────────────────────────────────────

router.get('/agents', async (req: Request, res: Response) => {
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

router.post('/agents/:id/toggle', async (req: Request, res: Response) => {
  try {
    const r = await query(`
      UPDATE agent_registry
      SET status = CASE WHEN status = 'idle' THEN 'paused' ELSE 'idle' END,
          last_active_at = NOW()
      WHERE agent_id = $1
      RETURNING *
    `, [req.params['id']]);
    if (!r.rows[0]) { res.status(404).json({ error: 'Agent not found' }); return; }
    res.json(r.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Dashboard command — routes text from UI chat into Sentinel brain ──────────

router.post('/command', async (req: Request, res: Response) => {
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
  // chatId 0 is an impossible Telegram chat_id (real ones are non-zero signed
  // integers). The dashboard route has no Telegram chat context — the UI
  // surface is agent_messages polling, not Telegram push — so slash-command
  // branches in handleCommand that route to showMainMenu / handleSprintCmd
  // etc. silently no-op on the Telegram send side (Telegram rejects chat_id=0).
  // The AI free-text branch (telegramAI's handleMessage) is what surfaces
  // dashboard replies and does not depend on chatId.
  // M-5 fix: previously passed `null`, which `String(null)` turned into the
  // string `"null"` — rejected by Telegram but masquerading as a stringified
  // value made the missing chat target hard to spot.
  handleCommand(text, 0, null, fromName, null).catch((err: any) =>
    logger.warn({ err: err.message }, 'Dashboard command failed')
  );

  res.json({ ok: true });
});

// ── Agent room messages ───────────────────────────────────────────────────────

router.get('/agent-room/messages', async (req: Request, res: Response) => {
  try {
    const rawLimit = req.query['limit'];
    const parsedLimit = Number(typeof rawLimit === 'string' ? rawLimit : '50');
    const safeLimit = Number.isFinite(parsedLimit) && Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50;
    const limit = Math.min(safeLimit, 200);
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

router.get('/sprints/current', async (req: Request, res: Response) => {
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

router.post('/sprint/approve', async (req: Request, res: Response) => {
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

router.post('/sprint/skip', async (req: Request, res: Response) => {
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

router.get('/security/portfolio', async (req: Request, res: Response) => {
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

router.post('/system/set-builder', async (req: Request, res: Response) => {
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

router.post('/repo/:name/audit', async (req: Request, res: Response) => {
  const name = req.params['name'];
  if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
    res.status(400).json({ error: 'Invalid repository name' });
    return;
  }

  // Respond immediately; audit runs async in background
  res.json({ ok: true, message: `Audit queued for ${name}` });
  try {
    const { triggerAudit } = require('./auditOrchestrator');
    const { getDefaultBranch } = require('./repoDiscovery');
    const fullName = repoFullName(name);
    const branchName = await getDefaultBranch(fullName);
    triggerAudit({
      repoFullName:  fullName,
      repoName:      name,
      projectName:   name,
      commitSha:     `manual-${Date.now()}`,
      commitMessage: '[manual-audit]',
      branchName,
      authorName:    'Dashboard',
      authorEmail:   '',
      topicId:       null,
    }).catch((err: any) => logger.warn({ err: err.message, name }, 'Dashboard audit failed'));
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Could not start dashboard audit');
  }
});

router.post('/system/audit-all', (req: Request, res: Response) => {
  const { REPO_LIST }   = require('./portfolioAnalytics');
  const { triggerAudit } = require('./auditOrchestrator');
  const { getDefaultBranch } = require('./repoDiscovery');
  res.json({ ok: true, queued: REPO_LIST.length });
  for (const repo of REPO_LIST) {
    getDefaultBranch(repo.repoFullName)
      .catch(() => 'main')
      .then((branchName: string) => triggerAudit({
        repoFullName:  repo.repoFullName,
        repoName:      repo.repoName,
        projectName:   repo.repoName,
        commitSha:     `manual-${Date.now()}`,
        commitMessage: '[bulk-audit]',
        branchName,
        authorName:    'Dashboard',
        authorEmail:   '',
        topicId:       null,
      }))
      .catch((err: any) => logger.warn({ err: err.message, repo: repo.repoName }, 'Bulk audit item failed'));
  }
});

router.post('/system/security-scan', (req: Request, res: Response) => {
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

router.post('/security/issue/:id/patch', (req: Request, res: Response) => {
  res.status(501).json({
    error: 'Not implemented — use Telegram command /sentinel security-patch <repo> to patch issues',
  });
});

router.post('/system/pause', async (req: Request, res: Response) => {
  try {
    await query(`
      UPDATE agent_registry SET status='paused' WHERE status='idle'
    `);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/system/resume', async (req: Request, res: Response) => {
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

router.get('/costs', async (req: Request, res: Response) => {
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

router.get('/integrations/status', async (req: Request, res: Response) => {
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

router.get('/settings', async (req: Request, res: Response) => {
  try {
    const { getSettings } = require('./settingsDb');
    const settings = await getSettings();
    res.json(settings);
  } catch (err: any) {
    logger.error({ err: err.stack ?? err.message }, 'GET /settings error');
    res.status(500).json({ error: err.message });
  }
});

router.post('/settings/update', async (req: Request, res: Response) => {
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

