"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const pg_1 = require("pg");
const logger_1 = __importDefault(require("./logger"));
let pool = null;
function getPool() {
    if (!pool && process.env['DATABASE_URL']) {
        pool = new pg_1.Pool({
            connectionString: process.env['DATABASE_URL'],
            ssl: process.env['NODE_ENV'] === 'production'
                ? process.env['DATABASE_CA_CERT']
                    ? { ca: process.env['DATABASE_CA_CERT'], rejectUnauthorized: true }
                    : { rejectUnauthorized: true }
                : false,
            max: 10,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
        });
        pool.on('error', (err) => {
            logger_1.default.error({ err: err.stack ?? err.message }, 'PostgreSQL pool error');
        });
    }
    return pool;
}
async function query(text, params) {
    const p = getPool();
    if (!p) {
        throw new Error('DATABASE_URL not configured');
    }
    const start = Date.now();
    try {
        const result = await p.query(text, params);
        logger_1.default.debug({ duration: Date.now() - start, rows: result.rowCount }, 'DB query executed');
        return result;
    }
    catch (err) {
        logger_1.default.error({ err: err.message, query: text }, 'DB query failed');
        throw err;
    }
}
async function initSchema() {
    const p = getPool();
    if (!p) {
        logger_1.default.warn('DATABASE_URL not set — skipping schema init');
        return;
    }
    await query(`
    CREATE TABLE IF NOT EXISTS debug_attempts (
      id               SERIAL PRIMARY KEY,
      repo_full_name   TEXT NOT NULL,
      commit_sha       TEXT NOT NULL,
      attempt_number   INTEGER NOT NULL DEFAULT 0,
      max_attempts     INTEGER NOT NULL DEFAULT 5,
      status           TEXT NOT NULL DEFAULT 'in_progress',
      debugger_used    TEXT,
      fix_commit_sha   TEXT,
      fix_commit_url   TEXT,
      fix_branch       TEXT,
      fix_pr_url       TEXT,
      failure_reason   TEXT,
      build_provider   TEXT,
      build_url        TEXT,
      high_risk        BOOLEAN NOT NULL DEFAULT false,
      high_risk_reason TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
    await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_debug_attempts_repo_commit
      ON debug_attempts (repo_full_name, commit_sha);
  `);
    await query(`
    CREATE TABLE IF NOT EXISTS build_poll_jobs (
      id              SERIAL PRIMARY KEY,
      job_id          TEXT NOT NULL UNIQUE,
      repo_full_name  TEXT NOT NULL,
      commit_sha      TEXT NOT NULL,
      providers       TEXT[] NOT NULL DEFAULT '{}',
      attempt_number  INTEGER NOT NULL DEFAULT 0,
      max_attempts    INTEGER NOT NULL DEFAULT 20,
      status          TEXT NOT NULL DEFAULT 'pending',
      result          TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
    logger_1.default.info('Database schema initialised');
}
// ── Debug attempt helpers ────────────────────────────────────────────────────
async function getDebugAttempt(repoFullName, commitSha) {
    const r = await query('SELECT * FROM debug_attempts WHERE repo_full_name = $1 AND commit_sha = $2', [repoFullName, commitSha]);
    return r.rows[0] || null;
}
async function createDebugAttempt(data) {
    const r = await query(`
    INSERT INTO debug_attempts
      (repo_full_name, commit_sha, attempt_number, build_provider, build_url, failure_reason)
    VALUES ($1, $2, 0, $3, $4, $5)
    ON CONFLICT (repo_full_name, commit_sha) DO NOTHING
    RETURNING *
  `, [data.repoFullName, data.commitSha, data.buildProvider, data.buildUrl, data.failureReason]);
    return r.rows[0] || null;
}
async function incrementAttempt(repoFullName, commitSha, debuggerUsed) {
    const r = await query(`
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
async function updateDebugAttempt(repoFullName, commitSha, updates) {
    const fields = Object.keys(updates)
        .map((k, i) => `${k} = $${i + 3}`)
        .join(', ');
    const values = Object.values(updates);
    const r = await query(`UPDATE debug_attempts
     SET ${fields}, updated_at = NOW()
     WHERE repo_full_name = $1 AND commit_sha = $2
     RETURNING *`, [repoFullName, commitSha, ...values]);
    return r.rows[0] || null;
}
async function stopDebugAttempts(repoFullName) {
    await query(`UPDATE debug_attempts
     SET status = 'stopped', updated_at = NOW()
     WHERE repo_full_name = $1 AND status = 'in_progress'`, [repoFullName]);
}
module.exports = {
    query,
    initSchema,
    getDebugAttempt,
    createDebugAttempt,
    incrementAttempt,
    updateDebugAttempt,
    stopDebugAttempts,
};
//# sourceMappingURL=dbClient.js.map