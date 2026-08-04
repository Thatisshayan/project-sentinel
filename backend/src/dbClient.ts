import { Pool, QueryResult, QueryResultRow } from 'pg';
import fs from 'fs';
import path from 'path';
import logger from './logger';
import type { DebugAttemptRow } from './types/debugAttemptRow';

let pool: Pool | null = null;

const SLOW_QUERY_THRESHOLD_MS = parseInt(process.env['DB_SLOW_QUERY_ALERT_MS'] || '500', 10);

/**
 * Railway's managed Postgres/Redis are reachable at *.railway.internal
 * over Railway's private network — traffic never touches the public
 * internet, and Railway does not expose an easily-pinnable CA for their
 * managed internal databases. Strict cert validation there just fails
 * with "self-signed certificate in certificate chain" (confirmed live in
 * production on 2026-07-18 — see git history), not a real MITM exposure.
 * Only relax validation for that specific, network-isolated case;
 * anything else (an external/public DATABASE_URL) still defaults to
 * strict validation unless a CA is explicitly supplied.
 */
function isRailwayInternalHost(databaseUrl: string): boolean {
  try {
    // Parse the actual hostname rather than substring-matching the whole
    // connection string — .includes('.railway.internal') would also match
    // a malicious/misconfigured URL like
    // postgresql://user:pass@evil.com/.railway.internal (path) or
    // postgresql://.railway.internal@evil.com/db (userinfo).
    const { hostname } = new URL(databaseUrl);
    return hostname === 'railway.internal' || hostname.endsWith('.railway.internal');
  } catch {
    return false;
  }
}

/**
 * The `postgres` service in docker-compose.prod.yml (self-hosted deploy,
 * see docs/ORACLE_DEPLOY.md) is a plain postgres:16-alpine container on the
 * compose-internal Docker network only — never reachable outside the host —
 * and doesn't have SSL enabled at all. Unlike the Railway-internal case
 * below, this isn't "relax cert validation": the server has no TLS listener,
 * so SSL must be skipped entirely or every query fails with "The server
 * does not support SSL connections".
 */
function isSelfHostedComposeHost(databaseUrl: string): boolean {
  try {
    return new URL(databaseUrl).hostname === 'postgres';
  } catch {
    return false;
  }
}

function resolveSslConfig(): false | { ca?: string; rejectUnauthorized: boolean } {
  if (process.env['NODE_ENV'] !== 'production') return false;

  const databaseUrl = process.env['DATABASE_URL'] || '';
  if (isSelfHostedComposeHost(databaseUrl)) return false;

  const isRailwayInternal = isRailwayInternalHost(databaseUrl);
  const caCert = process.env['DATABASE_CA_CERT'];

  if (caCert) return { ca: caCert, rejectUnauthorized: true };

  // Railway's internal network doesn't expose a verifiable CA for its
  // self-signed cert, so relax verification only for that specific host;
  // every other production connection requires strict verification.
  return { rejectUnauthorized: !isRailwayInternal };
}

function getPool(): Pool | null {
  if (!pool && process.env['DATABASE_URL']) {
    pool = new Pool({
      connectionString: process.env['DATABASE_URL'],
      ssl: resolveSslConfig(),
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err: Error) => {
      logger.error({ err: err.stack ?? err.message }, 'PostgreSQL pool error');
    });
  }
  return pool;
}

async function query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
  const p = getPool();
  if (!p) {
    throw new Error('DATABASE_URL not configured');
  }
  const start = Date.now();
  try {
    const result = await p.query<T>(text, params);
    const duration = Date.now() - start;
    if (duration >= SLOW_QUERY_THRESHOLD_MS) {
      logger.warn({ duration, rows: result.rowCount, thresholdMs: SLOW_QUERY_THRESHOLD_MS, query: text.slice(0, 300) }, 'Slow DB query detected');
      const { sendTelegramMessage } = require('./telegramClient');
      await sendTelegramMessage(
        `🐢 Slow DB query detected (${duration}ms >= ${SLOW_QUERY_THRESHOLD_MS}ms)\n\n${text.slice(0, 500)}`,
        null, null
      ).catch(() => null);
    } else {
      logger.debug(
        { duration, rows: result.rowCount },
        'DB query executed'
      );
    }
    return result;
  } catch (err) {
    logger.error({ err: (err as Error).message, query: text }, 'DB query failed');
    throw err;
  }
}

async function initSchema(): Promise<void> {
  const p = getPool();
  if (!p) {
    logger.warn('DATABASE_URL not set — skipping schema init');
    return;
  }
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const migrationsDir = path.resolve(process.cwd(), 'migrations');
  if (fs.existsSync(migrationsDir)) {
    const files = fs.readdirSync(migrationsDir)
      .filter((name) => /^\d+[-_].*\.sql$/i.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    for (const file of files) {
      const version = file.replace(/\.sql$/i, '');
      const applied = await query<{ version: string }>(
        'SELECT version FROM schema_migrations WHERE version = $1',
        [version]
      );
      if (applied.rows.length > 0) continue;

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await query(sql);
      await query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      logger.info({ version }, 'Applied database migration');
    }
  }
  logger.info('Database schema initialised');
}

// ── Debug attempt helpers ────────────────────────────────────────────────────

async function getDebugAttempt(repoFullName: string, commitSha: string): Promise<DebugAttemptRow | null> {
  const r = await query<DebugAttemptRow>(
    'SELECT * FROM debug_attempts WHERE repo_full_name = $1 AND commit_sha = $2',
    [repoFullName, commitSha]
  );
  return r.rows[0] || null;
}

interface DebugAttemptData {
  repoFullName: string;
  commitSha: string;
  buildProvider?: string;
  buildUrl?: string | null;
  failureReason?: string;
}

async function createDebugAttempt(data: DebugAttemptData): Promise<DebugAttemptRow | null> {
  const r = await query<DebugAttemptRow>(`
    INSERT INTO debug_attempts
      (repo_full_name, commit_sha, attempt_number, build_provider, build_url, failure_reason)
    VALUES ($1, $2, 0, $3, $4, $5)
    ON CONFLICT (repo_full_name, commit_sha) DO NOTHING
    RETURNING *
  `, [data.repoFullName, data.commitSha, data.buildProvider, data.buildUrl, data.failureReason]);
  return r.rows[0] || null;
}

async function incrementAttempt(repoFullName: string, commitSha: string, debuggerUsed: string): Promise<DebugAttemptRow | null> {
  const r = await query<DebugAttemptRow>(`
    UPDATE debug_attempts
    SET attempt_number = attempt_number + 1,
        debugger_used  = $3,
        status         = 'in_progress',
        updated_at     = NOW()
    WHERE repo_full_name = $1 AND commit_sha = $2
    RETURNING *
  `, [repoFullName, commitSha, debuggerUsed]);
  return r.rows[0] || null;
}

// Every column `updateDebugAttempt` is allowed to write — mirrors the
// mutable (non-identity, non-timestamp) columns in the debug_attempts
// table above. Building a SET clause straight from Object.keys(updates)
// was safe only by accident (every call site so far has passed hardcoded
// literal keys); the next caller that passes a dynamic/user-influenced key
// would have been a SQL injection point via the column name itself, since
// column identifiers can't be parameterized the way values can.
const DEBUG_ATTEMPT_UPDATABLE_COLUMNS = new Set([
  'attempt_number', 'max_attempts', 'status', 'debugger_used',
  'fix_commit_sha', 'fix_commit_url', 'fix_branch', 'fix_pr_url',
  'failure_reason', 'build_provider', 'build_url',
  'high_risk', 'high_risk_reason',
]);

type DebugAttemptUpdate = Partial<Pick<DebugAttemptRow,
  'attempt_number' | 'max_attempts' | 'status' | 'debugger_used' |
  'fix_commit_sha' | 'fix_commit_url' | 'fix_branch' | 'fix_pr_url' |
  'failure_reason' | 'build_provider' | 'build_url' |
  'high_risk' | 'high_risk_reason'
>>;

async function updateDebugAttempt(
  repoFullName: string,
  commitSha: string,
  updates: DebugAttemptUpdate
): Promise<DebugAttemptRow | null> {
  const keys = Object.keys(updates);
  const rejected = keys.filter(k => !DEBUG_ATTEMPT_UPDATABLE_COLUMNS.has(k));
  if (rejected.length > 0) {
    logger.error({ rejected, repoFullName, commitSha }, 'updateDebugAttempt: rejected non-allowlisted column(s)');
  }
  const allowedKeys = keys.filter(k => DEBUG_ATTEMPT_UPDATABLE_COLUMNS.has(k));
  if (allowedKeys.length === 0) {
    return null;
  }

  const fields = allowedKeys
    .map((k, i) => `${k} = $${i + 3}`)
    .join(', ');
  const values = allowedKeys.map(k => updates[k as keyof DebugAttemptUpdate]);

  const r = await query<DebugAttemptRow>(
    `UPDATE debug_attempts
     SET ${fields}, updated_at = NOW()
     WHERE repo_full_name = $1 AND commit_sha = $2
     RETURNING *`,
    [repoFullName, commitSha, ...values]
  );
  return r.rows[0] || null;
}

async function stopDebugAttempts(repoFullName: string): Promise<void> {
  await query(
    `UPDATE debug_attempts
     SET status = 'stopped', updated_at = NOW()
     WHERE repo_full_name = $1 AND status = 'in_progress'`,
    [repoFullName]
  );
}

/**
 * Marks a debug attempt genuinely resolved once its fix PR is confirmed
 * merged (called from the PR-merged webhook handler). This is the real
 * terminal "fixed" state — 'fix_pending' only means a PR was opened, not
 * that it was ever merged.
 */
async function resolveDebugAttemptByPr(repoFullName: string, prUrl: string): Promise<any | null> {
  const r = await query(
    `UPDATE debug_attempts
     SET status = 'resolved', updated_at = NOW()
     WHERE repo_full_name = $1 AND fix_pr_url = $2 AND status = 'fix_pending'
     RETURNING *`,
    [repoFullName, prUrl]
  );
  return r.rows[0] || null;
}

export = {
  query,
  initSchema,
  getDebugAttempt,
  createDebugAttempt,
  incrementAttempt,
  updateDebugAttempt,
  stopDebugAttempts,
  resolveDebugAttemptByPr,
  resolveSslConfig,
};

