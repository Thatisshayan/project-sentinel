const { query } = require('./dbClient');
const logger    = require('./logger');

async function initAgentSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS agent_registry (
      id              SERIAL PRIMARY KEY,
      agent_id        TEXT NOT NULL,
      agent_label     TEXT NOT NULL,
      repo_full_name  TEXT,
      task_type       TEXT,
      task_id         INTEGER,
      task_title      TEXT,
      status          TEXT NOT NULL DEFAULT 'idle',
      started_at      TIMESTAMPTZ,
      last_active_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_tasks INTEGER NOT NULL DEFAULT 0,
      failed_tasks    INTEGER NOT NULL DEFAULT 0
    );
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_registry_agent_id
      ON agent_registry (agent_id);
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS file_locks (
      id              SERIAL PRIMARY KEY,
      repo_full_name  TEXT NOT NULL,
      file_path       TEXT NOT NULL,
      locked_by       TEXT NOT NULL,
      task_id         INTEGER,
      locked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at      TIMESTAMPTZ NOT NULL
    );
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_file_locks_repo_file
      ON file_locks (repo_full_name, file_path);
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS agent_messages (
      id           SERIAL PRIMARY KEY,
      agent_id     TEXT NOT NULL,
      agent_label  TEXT NOT NULL,
      message      TEXT NOT NULL,
      message_type TEXT DEFAULT 'info',
      repo_name    TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS agent_room_config (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  logger.info('Agent schema initialised');
}

// ── Agent registry helpers ────────────────────────────────────────────────────

async function registerAgent(agentId, agentLabel) {
  await query(`
    INSERT INTO agent_registry (agent_id, agent_label, status)
    VALUES ($1, $2, 'idle')
    ON CONFLICT (agent_id) DO UPDATE SET
      agent_label    = EXCLUDED.agent_label,
      last_active_at = NOW()
  `, [agentId, agentLabel]);
}

async function setAgentWorking(agentId, data) {
  await query(`
    UPDATE agent_registry SET
      status         = 'working',
      repo_full_name = $2,
      task_type      = $3,
      task_id        = $4,
      task_title     = $5,
      started_at     = NOW(),
      last_active_at = NOW()
    WHERE agent_id = $1
  `, [agentId, data.repoFullName, data.taskType, data.taskId, data.taskTitle]);
}

async function setAgentIdle(agentId, success = true) {
  await query(`
    UPDATE agent_registry SET
      status         = 'idle',
      repo_full_name = NULL,
      task_type      = NULL,
      task_id        = NULL,
      task_title     = NULL,
      last_active_at = NOW(),
      completed_tasks = completed_tasks + ${success ? 1 : 0},
      failed_tasks    = failed_tasks    + ${success ? 0 : 1}
    WHERE agent_id = $1
  `, [agentId]);
}

async function markAgentError(agentId, reason) {
  await query(`
    UPDATE agent_registry
    SET status = 'error', task_title = $2, last_active_at = NOW()
    WHERE agent_id = $1
  `, [agentId, reason]);
}

async function getActiveAgents() {
  const r = await query(`
    SELECT * FROM agent_registry
    WHERE status = 'working'
    ORDER BY started_at ASC
  `);
  return r.rows;
}

async function getIdleAgents() {
  const r = await query(`
    SELECT * FROM agent_registry
    WHERE status = 'idle'
    ORDER BY completed_tasks DESC
  `);
  return r.rows;
}

async function getAllAgents() {
  const r = await query('SELECT * FROM agent_registry ORDER BY agent_id');
  return r.rows;
}

// ── File lock helpers ─────────────────────────────────────────────────────────

async function acquireFileLocks(repoFullName, filePaths, agentId, taskId) {
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours

  const conflicts = [];
  const acquired  = [];

  for (const filePath of filePaths) {
    const existing = await query(`
      SELECT * FROM file_locks
      WHERE repo_full_name = $1 AND file_path = $2
        AND expires_at > NOW()
    `, [repoFullName, filePath]);

    if (existing.rows.length > 0) {
      conflicts.push({ filePath, lockedBy: existing.rows[0].locked_by });
    } else {
      try {
        const inserted = await query(`
          INSERT INTO file_locks
            (repo_full_name, file_path, locked_by, task_id, expires_at)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (repo_full_name, file_path) DO NOTHING
        `, [repoFullName, filePath, agentId, taskId, expiresAt.toISOString()]);
        // ON CONFLICT DO NOTHING means a concurrent acquirer may have won the
        // race between our SELECT and this INSERT — only count it as acquired
        // if a row was actually inserted.
        if (inserted.rowCount > 0) {
          acquired.push(filePath);
        } else {
          const winner = await query(`
            SELECT locked_by FROM file_locks
            WHERE repo_full_name = $1 AND file_path = $2
          `, [repoFullName, filePath]);
          conflicts.push({ filePath, lockedBy: winner.rows[0]?.locked_by || 'unknown' });
        }
      } catch (e) {
        conflicts.push({ filePath, lockedBy: 'unknown' });
      }
    }
  }

  return { acquired, conflicts };
}

async function releaseFileLocks(repoFullName, agentId) {
  const r = await query(`
    DELETE FROM file_locks
    WHERE repo_full_name = $1 AND locked_by = $2
    RETURNING file_path
  `, [repoFullName, agentId]);
  return r.rows.map(row => row.file_path);
}

async function releaseExpiredLocks() {
  const r = await query(`
    DELETE FROM file_locks WHERE expires_at < NOW()
    RETURNING file_path, locked_by
  `);
  return r.rows;
}

// ── Message log helpers ───────────────────────────────────────────────────────

async function logAgentMessage(agentId, agentLabel, message, type, repoName) {
  await query(`
    INSERT INTO agent_messages
      (agent_id, agent_label, message, message_type, repo_name)
    VALUES ($1, $2, $3, $4, $5)
  `, [agentId, agentLabel, message.substring(0, 1000), type || 'info', repoName || null]);
}

async function getRecentMessages(limit = 20) {
  const r = await query(`
    SELECT * FROM agent_messages
    ORDER BY created_at DESC LIMIT $1
  `, [limit]);
  return r.rows.reverse();
}

// ── Agent room config ─────────────────────────────────────────────────────────

async function getConfig(key) {
  const r = await query('SELECT value FROM agent_room_config WHERE key = $1', [key]);
  return r.rows[0]?.value || null;
}

async function setConfig(key, value) {
  await query(`
    INSERT INTO agent_room_config (key, value) VALUES ($1, $2)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `, [key, String(value)]);
}

module.exports = {
  initAgentSchema,
  registerAgent,
  setAgentWorking,
  setAgentIdle,
  markAgentError,
  getActiveAgents,
  getIdleAgents,
  getAllAgents,
  acquireFileLocks,
  releaseFileLocks,
  releaseExpiredLocks,
  logAgentMessage,
  getRecentMessages,
  getConfig,
  setConfig,
};
