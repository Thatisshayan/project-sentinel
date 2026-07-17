import dbClient from './dbClient';
import logger from './logger';

const { query } = dbClient;

async function initBusinessSchema(): Promise<void> {
  // Daily business metric snapshots per repo/service
  await query(`
    CREATE TABLE IF NOT EXISTS business_metrics (
      id              SERIAL PRIMARY KEY,
      repo_name       TEXT NOT NULL,
      service         TEXT NOT NULL,
      metric_name     TEXT NOT NULL,
      metric_value    NUMERIC(15,4),
      metric_unit     TEXT,
      recorded_date   DATE NOT NULL,
      recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_business_metrics_unique
      ON business_metrics (repo_name, service, metric_name, recorded_date);
  `);

  // PR business impact tracking
  await query(`
    CREATE TABLE IF NOT EXISTS pr_impact (
      id                    SERIAL PRIMARY KEY,
      repo_full_name        TEXT NOT NULL,
      pr_number             INTEGER,
      pr_url                TEXT,
      merged_at             TIMESTAMPTZ,
      pre_merge_snapshot    JSONB,
      post_merge_snapshot   JSONB,
      impact_delta          JSONB,
      impact_score          NUMERIC(5,2),
      analysis_complete     BOOLEAN DEFAULT false,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // ROI scores for audit tasks
  await query(`
    CREATE TABLE IF NOT EXISTS task_roi_scores (
      id              SERIAL PRIMARY KEY,
      audit_task_id   INTEGER REFERENCES audit_tasks(id),
      repo_name       TEXT NOT NULL,
      base_score      NUMERIC(5,2) DEFAULT 5.0,
      priority_bonus  NUMERIC(5,2) DEFAULT 0,
      health_bonus    NUMERIC(5,2) DEFAULT 0,
      revenue_bonus   NUMERIC(5,2) DEFAULT 0,
      final_score     NUMERIC(5,2) DEFAULT 5.0,
      scoring_reason  TEXT,
      scored_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Unique per task so ON CONFLICT DO NOTHING works in upsertTaskROI
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_task_roi_audit_task
      ON task_roi_scores (audit_task_id);
  `);

  // Business metric connectors config
  await query(`
    CREATE TABLE IF NOT EXISTS metric_connectors (
      id              SERIAL PRIMARY KEY,
      connector_name  TEXT NOT NULL UNIQUE,
      repo_name       TEXT,
      is_active       BOOLEAN DEFAULT true,
      last_pull_at    TIMESTAMPTZ,
      last_error      TEXT,
      config          JSONB
    );
  `);

  logger.info('Business intelligence schema initialised');
}

// ── Business metrics helpers ──────────────────────────────────────────────────

async function upsertMetric(data: {
  repoName: string; service: string; metricName: string;
  metricValue: number; metricUnit?: string; recordedDate?: string;
}): Promise<void> {
  await query(`
    INSERT INTO business_metrics
      (repo_name, service, metric_name, metric_value, metric_unit, recorded_date)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (repo_name, service, metric_name, recorded_date)
    DO UPDATE SET metric_value = EXCLUDED.metric_value, recorded_at = NOW()
  `, [
    data.repoName, data.service, data.metricName,
    data.metricValue, data.metricUnit || 'count',
    data.recordedDate || new Date().toISOString().split('T')[0],
  ]);
}

async function getMetricTrend(repoName: string, metricName: string, days = 7): Promise<any[]> {
  const r = await query(`
    SELECT recorded_date, metric_value, metric_unit
    FROM business_metrics
    WHERE repo_name = $1 AND metric_name = $2
      AND recorded_date > CURRENT_DATE - $3
    ORDER BY recorded_date ASC
  `, [repoName, metricName, days]);
  return r.rows;
}

async function getLatestMetrics(repoName: string): Promise<any[]> {
  const r = await query(`
    SELECT DISTINCT ON (metric_name)
      metric_name, metric_value, metric_unit, recorded_date
    FROM business_metrics
    WHERE repo_name = $1
    ORDER BY metric_name, recorded_date DESC
  `, [repoName]);
  return r.rows;
}

async function recordPRImpact(data: {
  repoFullName: string; prNumber: number; prUrl: string;
  mergedAt: string; preSnapshot: any;
}): Promise<number | undefined> {
  const r = await query(`
    INSERT INTO pr_impact
      (repo_full_name, pr_number, pr_url, merged_at, pre_merge_snapshot)
    VALUES ($1,$2,$3,$4,$5)
    RETURNING id
  `, [
    data.repoFullName, data.prNumber, data.prUrl,
    data.mergedAt, JSON.stringify(data.preSnapshot),
  ]);
  return r.rows[0]?.id;
}

async function updatePRImpact(id: number, postSnapshot: any) {
  const pre     = await query('SELECT pre_merge_snapshot FROM pr_impact WHERE id=$1', [id]);
  const preData = pre.rows[0]?.pre_merge_snapshot || {};
  const delta   = calculateDelta(preData, postSnapshot);
  const score   = calculateImpactScore(delta);

  await query(`
    UPDATE pr_impact SET
      post_merge_snapshot = $2,
      impact_delta        = $3,
      impact_score        = $4,
      analysis_complete   = true
    WHERE id = $1
  `, [id, JSON.stringify(postSnapshot), JSON.stringify(delta), score]);

  return { delta, score };
}

function calculateDelta(pre: Record<string, any>, post: Record<string, any>) {
  const delta: Record<string, any> = {};
  for (const key of Object.keys(post)) {
    if (pre[key] !== undefined) {
      delta[key] = {
        before:        pre[key],
        after:         post[key],
        change:        post[key] - pre[key],
        changePercent: pre[key] !== 0
          ? ((post[key] - pre[key]) / Math.abs(pre[key]) * 100).toFixed(1)
          : null,
      };
    }
  }
  return delta;
}

function calculateImpactScore(delta: Record<string, any>): number | string {
  let score = 0;
  let count = 0;
  for (const metric of Object.values(delta)) {
    if (metric.change > 0) score += 1;
    if (metric.change < 0) score -= 1;
    count++;
  }
  return count > 0 ? ((score / count) * 10).toFixed(1) : 0;
}

async function upsertTaskROI(data: {
  auditTaskId: number; repoName: string; baseScore: number;
  priorityBonus: number; healthBonus: number; revenueBonus: number;
  finalScore: number; scoringReason: string;
}): Promise<void> {
  await query(`
    INSERT INTO task_roi_scores
      (audit_task_id, repo_name, base_score, priority_bonus,
       health_bonus, revenue_bonus, final_score, scoring_reason)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (audit_task_id) DO NOTHING
  `, [
    data.auditTaskId, data.repoName, data.baseScore,
    data.priorityBonus, data.healthBonus, data.revenueBonus,
    data.finalScore, data.scoringReason,
  ]);
}

export = {
  initBusinessSchema,
  upsertMetric,
  getMetricTrend,
  getLatestMetrics,
  recordPRImpact,
  updatePRImpact,
  upsertTaskROI,
};
