import dbClient from './dbClient';
import logger from './logger';
import type { ModelScoreRow, ComponentHealthRow, SelfAuditCycleRow } from './types/selfAuditRow';

const { query } = dbClient;

async function initSelfAuditSchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS self_audit_cycles (
      id              SERIAL PRIMARY KEY,
      status          TEXT NOT NULL DEFAULT 'running',
      health_score    NUMERIC(4,1),
      audit_summary   TEXT,
      tasks_generated INTEGER DEFAULT 0,
      tasks_approved  INTEGER DEFAULT 0,
      tasks_completed INTEGER DEFAULT 0,
      triggered_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at    TIMESTAMPTZ
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS model_performance (
      id              SERIAL PRIMARY KEY,
      model_id        TEXT NOT NULL,
      task_type       TEXT NOT NULL,
      complexity      TEXT,
      success         BOOLEAN NOT NULL,
      duration_ms     INTEGER,
      repo_full_name  TEXT,
      recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_model_performance_model_type
      ON model_performance (model_id, task_type, recorded_at DESC);
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS prompt_versions (
      id               SERIAL PRIMARY KEY,
      prompt_type      TEXT NOT NULL,
      version          INTEGER NOT NULL DEFAULT 1,
      content          TEXT NOT NULL,
      avg_success_rate NUMERIC(5,2),
      sample_count     INTEGER DEFAULT 0,
      is_active        BOOLEAN NOT NULL DEFAULT true,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      retired_at       TIMESTAMPTZ
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS component_health (
      id              SERIAL PRIMARY KEY,
      component_name  TEXT NOT NULL,
      failure_count   INTEGER NOT NULL DEFAULT 0,
      last_failure_at TIMESTAMPTZ,
      last_error      TEXT,
      healing_task_id INTEGER,
      status          TEXT NOT NULL DEFAULT 'healthy',
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_component_health_name
      ON component_health (component_name);
  `);

  // Single-row table tracking the last portfolio-wide self-healing alert —
  // backs a durable cooldown that survives process restarts, unlike an
  // in-memory timestamp.
  await query(`
    CREATE TABLE IF NOT EXISTS self_healer_alert_state (
      id             INTEGER PRIMARY KEY DEFAULT 1,
      last_alert_at  TIMESTAMPTZ,
      CONSTRAINT self_healer_alert_state_singleton CHECK (id = 1)
    );
  `);
  await query(`
    INSERT INTO self_healer_alert_state (id, last_alert_at)
    VALUES (1, NULL)
    ON CONFLICT (id) DO NOTHING
  `);

  logger.info('Self-audit schema initialised');
}

// ── Model performance helpers ─────────────────────────────────────────────────

async function recordModelOutcome(data: {
  modelId: string; taskType: string; complexity?: string;
  success: boolean; durationMs?: number; repoFullName?: string;
}): Promise<void> {
  await query(`
    INSERT INTO model_performance
      (model_id, task_type, complexity, success, duration_ms, repo_full_name)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [
    data.modelId, data.taskType, data.complexity || null,
    data.success, data.durationMs || null, data.repoFullName || null,
  ]);
}

async function getModelScores(taskType: string): Promise<ModelScoreRow[]> {
  const r = await query<ModelScoreRow>(`
    SELECT
      model_id,
      COUNT(*) as total,
      SUM(CASE WHEN success THEN 1 ELSE 0 END) as successes,
      ROUND(AVG(CASE WHEN success THEN 100.0 ELSE 0 END), 1) as success_rate,
      ROUND(AVG(duration_ms), 0) as avg_duration_ms
    FROM model_performance
    WHERE task_type = $1
      AND recorded_at > NOW() - INTERVAL '30 days'
    GROUP BY model_id
    HAVING COUNT(*) >= 3
    ORDER BY success_rate DESC, avg_duration_ms ASC
  `, [taskType]);
  return r.rows;
}

async function getBestModelForTask(taskType: string): Promise<string | null> {
  const scores = await getModelScores(taskType);
  if (scores.length === 0) return null;
  return scores[0]?.model_id ?? null;
}

// ── Component health helpers ──────────────────────────────────────────────────

async function recordComponentFailure(componentName: string, errorMessage?: string): Promise<void> {
  await query(`
    INSERT INTO component_health
      (component_name, failure_count, last_failure_at, last_error, status)
    VALUES ($1, 1, NOW(), $2, 'degraded')
    ON CONFLICT (component_name) DO UPDATE SET
      failure_count   = component_health.failure_count + 1,
      last_failure_at = NOW(),
      last_error      = EXCLUDED.last_error,
      status          = CASE
        WHEN component_health.failure_count + 1 >= 5 THEN 'failed'
        WHEN component_health.failure_count + 1 >= 3 THEN 'degraded'
        ELSE 'healthy'
      END,
      updated_at      = NOW()
  `, [componentName, (errorMessage || '').substring(0, 500)]);
}

async function recordComponentSuccess(componentName: string): Promise<void> {
  await query(`
    INSERT INTO component_health (component_name, failure_count, status)
    VALUES ($1, 0, 'healthy')
    ON CONFLICT (component_name) DO UPDATE SET
      failure_count = GREATEST(component_health.failure_count - 1, 0),
      status        = CASE
        WHEN component_health.failure_count - 1 <= 0 THEN 'healthy'
        ELSE component_health.status
      END,
      updated_at    = NOW()
  `, [componentName]);
}

/**
 * Atomically claims the self-healing alert slot if the cooldown has
 * elapsed (or no alert has ever been sent), returning true if the caller
 * should send the alert. Backed by Postgres so the cooldown survives a
 * process restart — a bare in-memory timestamp resets to 0 on every
 * redeploy, defeating the point of a cooldown.
 */
async function tryClaimSelfHealerAlert(cooldownMs: number): Promise<boolean> {
  const r = await query(`
    UPDATE self_healer_alert_state
    SET last_alert_at = NOW()
    WHERE id = 1
      AND (last_alert_at IS NULL OR last_alert_at < NOW() - ($1 || ' milliseconds')::INTERVAL)
    RETURNING id
  `, [cooldownMs]);
  return r.rows.length > 0;
}

async function getDegradedComponents(): Promise<ComponentHealthRow[]> {
  const r = await query<ComponentHealthRow>(`
    SELECT * FROM component_health
    WHERE status IN ('degraded','failed')
      AND failure_count >= 3
    ORDER BY failure_count DESC
  `);
  return r.rows;
}

// ── Self-audit cycle helpers ──────────────────────────────────────────────────

async function createSelfAuditCycle(): Promise<SelfAuditCycleRow> {
  const r = await query<SelfAuditCycleRow>(`
    INSERT INTO self_audit_cycles (status)
    VALUES ('running')
    RETURNING *
  `);
  return r.rows[0]!;
}

async function updateSelfAuditCycle(id: number, updates: Record<string, unknown>): Promise<SelfAuditCycleRow | null> {
  const keys   = Object.keys(updates);
  const values = Object.values(updates);
  const fields = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const r = await query<SelfAuditCycleRow>(
    `UPDATE self_audit_cycles SET ${fields} WHERE id = $1 RETURNING *`,
    [id, ...values]
  );
  return r.rows[0] || null;
}

export = {
  initSelfAuditSchema,
  recordModelOutcome,
  getModelScores,
  getBestModelForTask,
  recordComponentFailure,
  recordComponentSuccess,
  getDegradedComponents,
  tryClaimSelfHealerAlert,
  createSelfAuditCycle,
  updateSelfAuditCycle,
};
