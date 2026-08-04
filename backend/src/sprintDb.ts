import dbClient from './dbClient';
import logger from './logger';
import type { SprintRow, SprintTaskRow, VelocityMetricRow } from './types/sprintRow';

const { query } = dbClient;

async function initSprintSchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS sprints (
      id                  SERIAL PRIMARY KEY,
      week_start          DATE NOT NULL UNIQUE,
      week_end            DATE NOT NULL,
      status              TEXT NOT NULL DEFAULT 'proposed',
      proposed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      approved_at         TIMESTAMPTZ,
      completed_at        TIMESTAMPTZ,
      total_tasks         INTEGER DEFAULT 0,
      completed_tasks     INTEGER DEFAULT 0,
      failed_tasks        INTEGER DEFAULT 0,
      skipped_tasks       INTEGER DEFAULT 0,
      estimated_cost      NUMERIC(10,4) DEFAULT 0,
      actual_cost         NUMERIC(10,4) DEFAULT 0,
      health_start        NUMERIC(4,1),
      health_end          NUMERIC(4,1),
      proposal_summary    TEXT,
      telegram_message_id INTEGER
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS sprint_tasks (
      id               SERIAL PRIMARY KEY,
      sprint_id        INTEGER NOT NULL REFERENCES sprints(id),
      audit_task_id    INTEGER,
      repo_full_name   TEXT NOT NULL,
      repo_name        TEXT NOT NULL,
      task_title       TEXT NOT NULL,
      task_description TEXT,
      priority         TEXT DEFAULT 'medium',
      complexity       TEXT DEFAULT 'medium',
      builder_agent    TEXT DEFAULT 'nvidia',
      estimated_cost   NUMERIC(10,4) DEFAULT 0,
      execution_order  INTEGER NOT NULL,
      status           TEXT NOT NULL DEFAULT 'queued',
      started_at       TIMESTAMPTZ,
      completed_at     TIMESTAMPTZ,
      pr_url           TEXT,
      failure_reason   TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_sprint_tasks_sprint
      ON sprint_tasks (sprint_id, execution_order);
  `);

  // See auditDb.ts's matching migration comment — builder_agent's default
  // was 'claude' (Claude Code isn't wired; getBuilderConfig() silently
  // redirected it to 'nvidia' anyway). ALTER is needed on top of the
  // CREATE TABLE default above since that only applies to a fresh table.
  await query(`ALTER TABLE sprint_tasks ALTER COLUMN builder_agent SET DEFAULT 'nvidia';`);

  await query(`
    CREATE TABLE IF NOT EXISTS velocity_metrics (
      id               SERIAL PRIMARY KEY,
      week_start       DATE NOT NULL UNIQUE,
      tasks_completed  INTEGER DEFAULT 0,
      prs_merged       INTEGER DEFAULT 0,
      builds_fixed     INTEGER DEFAULT 0,
      avg_health       NUMERIC(4,1),
      health_delta     NUMERIC(4,1),
      api_cost         NUMERIC(10,4) DEFAULT 0,
      active_repos     INTEGER DEFAULT 0,
      recorded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  logger.info('Sprint schema initialised');
}

// ── Sprint helpers ────────────────────────────────────────────────────────────

async function getCurrentSprint(): Promise<SprintRow | null> {
  const r = await query(`
    SELECT * FROM sprints
    WHERE status IN ('approved','executing','proposed','paused')
    ORDER BY week_start DESC LIMIT 1
  `);
  return r.rows[0] || null;
}

async function getSprintById(id: number): Promise<SprintRow | null> {
  const r = await query('SELECT * FROM sprints WHERE id=$1', [id]);
  return r.rows[0] || null;
}

async function createSprint(data: {
  weekStart: string; weekEnd: string; totalTasks: number;
  estimatedCost: number; healthStart: number; proposalSummary: string;
}): Promise<SprintRow> {
  const r = await query(`
    INSERT INTO sprints
      (week_start, week_end, total_tasks, estimated_cost,
       health_start, proposal_summary, status)
    VALUES ($1,$2,$3,$4,$5,$6,'proposed')
    RETURNING *
  `, [
    data.weekStart, data.weekEnd, data.totalTasks,
    data.estimatedCost, data.healthStart, data.proposalSummary,
  ]);
  return r.rows[0];
}

async function updateSprint(id: number, updates: Record<string, unknown>): Promise<SprintRow | null> {
  const keys   = Object.keys(updates);
  const values = Object.values(updates);
  const fields = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const r = await query(
    `UPDATE sprints SET ${fields} WHERE id=$1 RETURNING *`,
    [id, ...values]
  );
  return r.rows[0] || null;
}

async function createSprintTask(data: {
  sprintId: number; auditTaskId?: number; repoFullName: string;
  repoName: string; taskTitle: string; taskDescription?: string;
  priority?: string; complexity?: string; builderAgent?: string;
  estimatedCost?: number; executionOrder: number;
}): Promise<SprintTaskRow> {
  const r = await query(`
    INSERT INTO sprint_tasks
      (sprint_id, audit_task_id, repo_full_name, repo_name,
       task_title, task_description, priority, complexity,
       builder_agent, estimated_cost, execution_order, status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'queued')
    RETURNING *
  `, [
    data.sprintId,      data.auditTaskId,    data.repoFullName,
    data.repoName,      data.taskTitle,      data.taskDescription,
    data.priority,      data.complexity,     data.builderAgent,
    data.estimatedCost, data.executionOrder,
  ]);
  return r.rows[0];
}

async function getNextSprintTask(sprintId: number): Promise<SprintTaskRow | null> {
  const r = await query(`
    SELECT * FROM sprint_tasks
    WHERE sprint_id = $1 AND status = 'queued'
    ORDER BY execution_order ASC
    LIMIT 1
  `, [sprintId]);
  return r.rows[0] || null;
}

async function updateSprintTask(id: number, updates: Record<string, unknown>): Promise<SprintTaskRow | null> {
  const keys   = Object.keys(updates);
  const values = Object.values(updates);
  const fields = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const r = await query(
    `UPDATE sprint_tasks SET ${fields}, updated_at=NOW() WHERE id=$1 RETURNING *`,
    [id, ...values]
  );
  return r.rows[0] || null;
}

async function getSprintTasks(sprintId: number): Promise<SprintTaskRow[]> {
  const r = await query(`
    SELECT * FROM sprint_tasks
    WHERE sprint_id = $1
    ORDER BY execution_order ASC
  `, [sprintId]);
  return r.rows;
}

async function recordVelocity(data: {
  weekStart: string; tasksCompleted: number; prsMerged: number;
  buildsFixed: number; avgHealth: number; healthDelta: number;
  apiCost: number; activeRepos: number;
}): Promise<void> {
  await query(`
    INSERT INTO velocity_metrics
      (week_start, tasks_completed, prs_merged, builds_fixed,
       avg_health, health_delta, api_cost, active_repos)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (week_start) DO UPDATE SET
      tasks_completed = EXCLUDED.tasks_completed,
      prs_merged      = EXCLUDED.prs_merged,
      builds_fixed    = EXCLUDED.builds_fixed,
      avg_health      = EXCLUDED.avg_health,
      health_delta    = EXCLUDED.health_delta,
      api_cost        = EXCLUDED.api_cost
  `, [
    data.weekStart,     data.tasksCompleted, data.prsMerged,
    data.buildsFixed,   data.avgHealth,      data.healthDelta,
    data.apiCost,       data.activeRepos,
  ]);
}

async function getVelocityTrend(weeks = 4): Promise<VelocityMetricRow[]> {
  const r = await query(`
    SELECT * FROM velocity_metrics
    ORDER BY week_start DESC
    LIMIT $1
  `, [weeks]);
  return r.rows.reverse(); // oldest first
}

export = {
  initSprintSchema,
  getCurrentSprint,
  getSprintById,
  createSprint,
  updateSprint,
  createSprintTask,
  getNextSprintTask,
  updateSprintTask,
  getSprintTasks,
  recordVelocity,
  getVelocityTrend,
};
