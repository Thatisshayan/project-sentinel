import dbClient from './dbClient';
import logger from './logger';
import type { PortfolioMetricRow, RepoPatternRow, RepoCostRow } from './types/portfolioRow';

const { query } = dbClient;

async function initPortfolioSchema(): Promise<void> {
  // Daily health snapshot per repo
  await query(`
    CREATE TABLE IF NOT EXISTS portfolio_metrics (
      id              SERIAL PRIMARY KEY,
      repo_full_name  TEXT NOT NULL,
      repo_name       TEXT NOT NULL,
      health_score    NUMERIC(4,1),
      build_status    TEXT,
      priority        TEXT DEFAULT 'medium',
      builds_passed   INTEGER DEFAULT 0,
      builds_failed   INTEGER DEFAULT 0,
      tasks_done      INTEGER DEFAULT 0,
      tasks_queued    INTEGER DEFAULT 0,
      debugger_runs   INTEGER DEFAULT 0,
      last_commit_at  TIMESTAMPTZ,
      last_build_at   TIMESTAMPTZ,
      recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_portfolio_metrics_repo_date
      ON portfolio_metrics (repo_full_name, recorded_at DESC);
  `);

  // API cost tracking per operation
  await query(`
    CREATE TABLE IF NOT EXISTS api_costs (
      id              SERIAL PRIMARY KEY,
      repo_full_name  TEXT,
      operation       TEXT NOT NULL,
      model           TEXT NOT NULL,
      input_tokens    INTEGER DEFAULT 0,
      output_tokens   INTEGER DEFAULT 0,
      estimated_cost  NUMERIC(10,6) DEFAULT 0,
      recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_api_costs_date
      ON api_costs (recorded_at DESC);
  `);

  // Cross-repo pattern detection
  await query(`
    CREATE TABLE IF NOT EXISTS repo_patterns (
      id              SERIAL PRIMARY KEY,
      pattern_type    TEXT NOT NULL,
      pattern_key     TEXT NOT NULL,
      description     TEXT,
      affected_repos  TEXT[],
      severity        TEXT DEFAULT 'medium',
      status          TEXT DEFAULT 'open',
      first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at     TIMESTAMPTZ
    );
  `);

  // Daily report log
  await query(`
    CREATE TABLE IF NOT EXISTS daily_reports (
      id              SERIAL PRIMARY KEY,
      report_date     DATE NOT NULL UNIQUE,
      health_average  NUMERIC(4,1),
      builds_passed   INTEGER DEFAULT 0,
      builds_failed   INTEGER DEFAULT 0,
      tasks_completed INTEGER DEFAULT 0,
      daily_cost      NUMERIC(10,4) DEFAULT 0,
      monthly_cost    NUMERIC(10,4) DEFAULT 0,
      telegram_sent   BOOLEAN DEFAULT false,
      sent_at         TIMESTAMPTZ
    );
  `);

  // Repos discovered dynamically on GitHub (not in the static WATCHED_REPOS
  // env var). Lets Sentinel pick up newly-created repos without a redeploy.
  await query(`
    CREATE TABLE IF NOT EXISTS discovered_repos (
      id              SERIAL PRIMARY KEY,
      repo_name       TEXT NOT NULL UNIQUE,
      repo_full_name  TEXT NOT NULL,
      github_id       BIGINT,
      is_private      BOOLEAN DEFAULT true,
      discovered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      onboarded_at    TIMESTAMPTZ,
      onboard_error   TEXT
    );
  `);

  logger.info('Portfolio schema initialised');
}

// ── Portfolio metrics helpers ─────────────────────────────────────────────────

async function upsertRepoMetrics(data: {
  repoFullName: string; repoName: string; healthScore?: number;
  buildStatus?: string; priority?: string; buildsPassedToday?: number;
  buildsFailedToday?: number; tasksDoneToday?: number; tasksQueued?: number;
  debuggerRunsToday?: number; lastBuildAt?: string | Date | null; lastCommitAt?: string | Date | null;
}): Promise<void> {
  await query(`
    INSERT INTO portfolio_metrics
      (repo_full_name, repo_name, health_score, build_status,
       priority, builds_passed, builds_failed, tasks_done,
       tasks_queued, debugger_runs, last_build_at, last_commit_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
  `, [
    data.repoFullName,      data.repoName,         data.healthScore ?? null,
    data.buildStatus ?? null, data.priority ?? null, data.buildsPassedToday ?? null,
    data.buildsFailedToday ?? null, data.tasksDoneToday ?? null, data.tasksQueued ?? null,
    data.debuggerRunsToday ?? null, data.lastBuildAt ?? null, data.lastCommitAt ?? null,
  ]);
}

async function getLatestMetrics(repoFullName: string): Promise<PortfolioMetricRow | null> {
  const r = await query(`
    SELECT * FROM portfolio_metrics
    WHERE repo_full_name = $1
    ORDER BY recorded_at DESC LIMIT 1
  `, [repoFullName]);
  return r.rows[0] || null;
}

async function getAllLatestMetrics(): Promise<PortfolioMetricRow[]> {
  const r = await query(`
    SELECT DISTINCT ON (repo_full_name) *
    FROM portfolio_metrics
    ORDER BY repo_full_name, recorded_at DESC
  `);
  return r.rows;
}

// ── Cost helpers ──────────────────────────────────────────────────────────────

async function logApiCost(data: {
  repoFullName?: string; operation: string; model: string;
  inputTokens?: number; outputTokens?: number; estimatedCost?: number;
}): Promise<void> {
  await query(`
    INSERT INTO api_costs
      (repo_full_name, operation, model, input_tokens, output_tokens, estimated_cost)
    VALUES ($1,$2,$3,$4,$5,$6)
  `, [
    data.repoFullName, data.operation, data.model,
    data.inputTokens || 0, data.outputTokens || 0,
    data.estimatedCost || 0,
  ]);
}

async function getDailyCost(): Promise<number> {
  const r = await query(`
    SELECT COALESCE(SUM(estimated_cost), 0) as total
    FROM api_costs
    WHERE recorded_at > NOW() - INTERVAL '24 hours'
  `);
  return parseFloat(r.rows[0]?.total || '0');
}

async function getMonthlyCost(): Promise<number> {
  const r = await query(`
    SELECT COALESCE(SUM(estimated_cost), 0) as total
    FROM api_costs
    WHERE recorded_at > DATE_TRUNC('month', NOW())
  `);
  return parseFloat(r.rows[0]?.total || '0');
}

async function getWeeklyCost(): Promise<number> {
  const r = await query(`
    SELECT COALESCE(SUM(estimated_cost), 0) as total
    FROM api_costs
    WHERE recorded_at > NOW() - INTERVAL '7 days'
  `);
  return parseFloat(r.rows[0]?.total || '0');
}

async function getCostByRepo(days = 7): Promise<RepoCostRow[]> {
  const r = await query<RepoCostRow>(`
    SELECT repo_full_name,
           COALESCE(SUM(estimated_cost), 0) as total,
           COUNT(*) as operations
    FROM api_costs
    WHERE recorded_at > NOW() - ($1 || ' days')::INTERVAL
      AND repo_full_name IS NOT NULL
    GROUP BY repo_full_name
    ORDER BY total DESC
  `, [days]);
  return r.rows;
}

// ── Pattern helpers ───────────────────────────────────────────────────────────

async function upsertPattern(data: {
  patternType: string; patternKey: string; description?: string;
  affectedRepos?: string[]; severity?: string;
}): Promise<number> {
  const existing = await query(`
    SELECT id FROM repo_patterns
    WHERE pattern_key = $1 AND status = 'open'
    LIMIT 1
  `, [data.patternKey]);

  if (existing.rows.length > 0) {
    await query(`
      UPDATE repo_patterns
      SET affected_repos = $2, last_seen_at = NOW()
      WHERE id = $1
    `, [existing.rows[0].id, data.affectedRepos]);
    return existing.rows[0].id;
  }

  const r = await query(`
    INSERT INTO repo_patterns
      (pattern_type, pattern_key, description, affected_repos, severity)
    VALUES ($1,$2,$3,$4,$5)
    RETURNING id
  `, [
    data.patternType, data.patternKey, data.description,
    data.affectedRepos, data.severity || 'medium',
  ]);
  return r.rows[0].id;
}

async function getOpenPatterns(): Promise<RepoPatternRow[]> {
  const r = await query(`
    SELECT * FROM repo_patterns
    WHERE status = 'open'
    ORDER BY severity DESC, last_seen_at DESC
  `);
  return r.rows;
}

// ── Discovered repos helpers ─────────────────────────────────────────────────

async function getDiscoveredRepoNames(): Promise<string[]> {
  const r = await query<{ repo_name: string }>(`SELECT repo_name FROM discovered_repos`);
  return r.rows.map((row) => row.repo_name);
}

async function getOnboardedDiscoveredRepos(): Promise<{ repoName: string; repoFullName: string }[]> {
  const r = await query<{ repo_name: string; repo_full_name: string }>(`
    SELECT repo_name, repo_full_name FROM discovered_repos
    WHERE onboarded_at IS NOT NULL
    ORDER BY discovered_at ASC
  `);
  return r.rows.map((row) => ({ repoName: row.repo_name, repoFullName: row.repo_full_name }));
}

async function insertDiscoveredRepo({ repoName, repoFullName, githubId, isPrivate }: {
  repoName: string; repoFullName: string; githubId?: number; isPrivate?: boolean;
}): Promise<void> {
  await query(`
    INSERT INTO discovered_repos (repo_name, repo_full_name, github_id, is_private)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (repo_name) DO NOTHING
  `, [repoName, repoFullName, githubId ?? null, isPrivate ?? true]);
}

async function markDiscoveredRepoOnboarded(repoName: string, error: string | null = null): Promise<void> {
  await query(`
    UPDATE discovered_repos
    SET onboarded_at = CASE WHEN $2::text IS NULL THEN NOW() ELSE onboarded_at END,
        onboard_error = $2
    WHERE repo_name = $1
  `, [repoName, error]);
}

export = {
  initPortfolioSchema,
  upsertRepoMetrics,
  getLatestMetrics,
  getAllLatestMetrics,
  logApiCost,
  getDailyCost,
  getWeeklyCost,
  getMonthlyCost,
  getCostByRepo,
  upsertPattern,
  getOpenPatterns,
  getDiscoveredRepoNames,
  getOnboardedDiscoveredRepos,
  insertDiscoveredRepo,
  markDiscoveredRepoOnboarded,
};
