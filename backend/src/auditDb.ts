import dbClient from './dbClient';
import logger from './logger';

const { query } = dbClient;

async function initAuditSchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS audit_cycles (
      id                SERIAL PRIMARY KEY,
      repo_full_name    TEXT NOT NULL,
      commit_sha        TEXT NOT NULL,
      project_name      TEXT,
      status            TEXT NOT NULL DEFAULT 'auditing',
      health_score      INTEGER,
      audit_summary     TEXT,
      audit_agent       TEXT DEFAULT 'claude-code',
      tasks_total       INTEGER DEFAULT 0,
      tasks_safe        INTEGER DEFAULT 0,
      tasks_done        INTEGER DEFAULT 0,
      tasks_failed      INTEGER DEFAULT 0,
      approval_sent_at  TIMESTAMPTZ,
      approved_at       TIMESTAMPTZ,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_cycles_repo_commit
      ON audit_cycles (repo_full_name, commit_sha);
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS audit_tasks (
      id                   SERIAL PRIMARY KEY,
      audit_cycle_id       INTEGER NOT NULL REFERENCES audit_cycles(id),
      repo_full_name       TEXT NOT NULL,
      task_number          INTEGER NOT NULL,
      title                TEXT NOT NULL,
      description          TEXT,
      priority             TEXT NOT NULL DEFAULT 'medium',
      category             TEXT,
      affected_files       TEXT[],
      complexity           TEXT DEFAULT 'medium',
      safe_to_auto_execute BOOLEAN NOT NULL DEFAULT false,
      safety_reason        TEXT,
      acceptance_criteria  TEXT,
      status               TEXT NOT NULL DEFAULT 'queued',
      batch_number         INTEGER,
      builder_agent        TEXT DEFAULT 'claude',
      notion_page_id       TEXT,
      branch_name          TEXT,
      commit_sha           TEXT,
      commit_url           TEXT,
      pr_url               TEXT,
      pr_number            INTEGER,
      failure_reason       TEXT,
      retry_count          INTEGER NOT NULL DEFAULT 0,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_audit_tasks_cycle
      ON audit_tasks (audit_cycle_id);
  `);

  // Phase 2 of docs/2026-07-22-slack-agent-roster-plan.md — tags which
  // engine produced a task so notifications/reports can show provenance
  // once CodeRabbit becomes the primary audit engine.
  await query(`ALTER TABLE audit_tasks ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'sentinel';`);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_audit_tasks_repo_status
      ON audit_tasks (repo_full_name, status);
  `);

  logger.info('Audit schema initialised');
}

async function getAuditCycle(repoFullName: string, commitSha: string): Promise<any | null> {
  const r = await query(
    'SELECT * FROM audit_cycles WHERE repo_full_name=$1 AND commit_sha=$2',
    [repoFullName, commitSha]
  );
  return r.rows[0] || null;
}

async function getActiveCycleForRepo(repoFullName: string): Promise<any | null> {
  const r = await query(`
    SELECT * FROM audit_cycles
    WHERE repo_full_name = $1
      AND status NOT IN ('complete','skipped','failed')
    ORDER BY created_at DESC LIMIT 1
  `, [repoFullName]);
  return r.rows[0] || null;
}

async function getLastCompletedAudit(repoFullName: string): Promise<any | null> {
  const r = await query(`
    SELECT created_at FROM audit_cycles
    WHERE repo_full_name = $1
      AND status IN ('complete','tasks_written','awaiting_approval','executing')
    ORDER BY created_at DESC LIMIT 1
  `, [repoFullName]);
  return r.rows[0] || null;
}

/**
 * Most recent PRIOR audit's health score for a repo (excluding the cycle
 * just created) — used to show a health trend (↑/↓/→) in the audit-complete
 * Telegram message so a human can see whether things are getting better or
 * worse at a glance, not just the current absolute score.
 */
async function getPreviousHealthScore(repoFullName: string, excludeCycleId: number): Promise<number | null> {
  const r = await query(`
    SELECT health_score FROM audit_cycles
    WHERE repo_full_name = $1 AND id != $2 AND health_score IS NOT NULL
    ORDER BY created_at DESC LIMIT 1
  `, [repoFullName, excludeCycleId]);
  return r.rows[0]?.health_score ?? null;
}

async function createAuditCycle(data: { repoFullName: string; commitSha: string; projectName?: string }): Promise<any | null> {
  const r = await query(`
    INSERT INTO audit_cycles
      (repo_full_name, commit_sha, project_name, status, audit_agent)
    VALUES ($1,$2,$3,'auditing','claude-code')
    ON CONFLICT (repo_full_name, commit_sha) DO NOTHING
    RETURNING *
  `, [data.repoFullName, data.commitSha, data.projectName]);
  return r.rows[0] || null;
}

async function updateAuditCycle(id: number, updates: Record<string, any>): Promise<any | null> {
  const keys   = Object.keys(updates);
  const values = Object.values(updates);
  const fields = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const r = await query(
    `UPDATE audit_cycles SET ${fields}, updated_at=NOW() WHERE id=$1 RETURNING *`,
    [id, ...values]
  );
  return r.rows[0] || null;
}

async function getQueuedTaskCount(repoFullName: string): Promise<number> {
  const r = await query(`
    SELECT COUNT(*) as count FROM audit_tasks
    WHERE repo_full_name=$1
      AND status IN ('queued','in_progress')
  `, [repoFullName]);
  return parseInt(r.rows[0]?.count || '0');
}

async function createAuditTask(data: {
  auditCycleId: number; repoFullName: string; taskNumber: number;
  title: string; description?: string; priority?: string; category?: string;
  affectedFiles?: string[]; complexity?: string; safeToAutoExecute?: boolean;
  safetyReason?: string; acceptanceCriteria?: string; batchNumber?: number;
  builderAgent?: string; source?: string;
}): Promise<any | null> {
  const r = await query(`
    INSERT INTO audit_tasks
      (audit_cycle_id, repo_full_name, task_number, title, description,
       priority, category, affected_files, complexity,
       safe_to_auto_execute, safety_reason, acceptance_criteria,
       batch_number, builder_agent, source, status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'queued')
    RETURNING *
  `, [
    data.auditCycleId,      data.repoFullName,       data.taskNumber,
    data.title,             data.description,        data.priority,
    data.category,          data.affectedFiles || [], data.complexity,
    data.safeToAutoExecute, data.safetyReason,       data.acceptanceCriteria,
    data.batchNumber,       data.builderAgent || 'qwen_coder',
    data.source || 'sentinel',
  ]);
  return r.rows[0] || null;
}

async function getNextBatch(repoFullName: string, batchSize: number): Promise<any[]> {
  // Eligibility is decided by the task's own status/safe flag, not by its
  // original parent cycle's status — executeApprovedTasks() always creates
  // or reuses the *current* cycle to drive execution, so gating on the
  // original cycle's status here orphaned any task whose old cycle had
  // since completed, permanently blocking otherwise-safe queued tasks.
  const r = await query(`
    SELECT * FROM audit_tasks
    WHERE repo_full_name = $1
      AND status = 'queued'
      AND safe_to_auto_execute = true
    ORDER BY batch_number ASC, task_number ASC
    LIMIT $2
  `, [repoFullName, batchSize]);
  return r.rows;
}

async function updateAuditTask(id: number, updates: Record<string, any>): Promise<any | null> {
  const keys   = Object.keys(updates);
  const values = Object.values(updates);
  const fields = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const r = await query(
    `UPDATE audit_tasks SET ${fields}, updated_at=NOW() WHERE id=$1 RETURNING *`,
    [id, ...values]
  );
  return r.rows[0] || null;
}

async function checkDuplicateTask(repoFullName: string, title: string): Promise<boolean> {
  const r = await query(`
    SELECT id FROM audit_tasks
    WHERE repo_full_name=$1
      AND LOWER(title)=LOWER($2)
      AND status IN ('queued','in_progress','build_check')
    LIMIT 1
  `, [repoFullName, title]);
  return r.rows.length > 0;
}

async function countTasksExecutedToday(repoFullName: string): Promise<number> {
  const r = await query(`
    SELECT COUNT(*) as count FROM audit_tasks
    WHERE repo_full_name=$1
      AND status IN ('done','build_check','in_progress')
      AND updated_at > NOW() - INTERVAL '24 hours'
  `, [repoFullName]);
  return parseInt(r.rows[0]?.count || '0');
}

async function stopAllTasksForRepo(repoFullName: string): Promise<void> {
  await query(`
    UPDATE audit_tasks SET status='skipped', updated_at=NOW()
    WHERE repo_full_name=$1 AND status IN ('queued','in_progress')
  `, [repoFullName]);
  await query(`
    UPDATE audit_cycles SET status='skipped', updated_at=NOW()
    WHERE repo_full_name=$1 AND status NOT IN ('complete','skipped','failed')
  `, [repoFullName]);
}

async function markTasksDoneForBranch(repoFullName: string, branchName: string): Promise<void> {
  await query(`
    UPDATE audit_tasks SET status='done', updated_at=NOW()
    WHERE repo_full_name=$1 AND branch_name=$2 AND status='build_check'
  `, [repoFullName, branchName]);
}

export = {
  initAuditSchema,
  getAuditCycle,
  getActiveCycleForRepo,
  getLastCompletedAudit,
  getPreviousHealthScore,
  createAuditCycle,
  updateAuditCycle,
  getQueuedTaskCount,
  createAuditTask,
  getNextBatch,
  updateAuditTask,
  checkDuplicateTask,
  countTasksExecutedToday,
  stopAllTasksForRepo,
  markTasksDoneForBranch,
};
