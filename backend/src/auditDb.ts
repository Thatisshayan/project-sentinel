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

  // D-027 item 5 (multi-aspect audit + scoring + rotation) — which single
  // aspect (security, frontend, backend, ...) this cycle's 10 tasks focused
  // on, plus an aspect-scoped score distinct from the whole-repo score. See
  // auditAspects.ts.
  await query(`ALTER TABLE audit_cycles ADD COLUMN IF NOT EXISTS aspect TEXT;`);
  await query(`ALTER TABLE audit_cycles ADD COLUMN IF NOT EXISTS aspect_health_score INTEGER;`);
  await query(`ALTER TABLE audit_cycles ADD COLUMN IF NOT EXISTS aspect_effect_summary TEXT;`);

  // Guards against a race in concurrent-webhook-driven task creation (e.g.
  // processCodeRabbitPRComment.ts, where multiple GitHub webhook deliveries
  // for the same PR can arrive near-simultaneously): without this, two
  // requests reading the same "next task number" before either insert
  // commits would silently create two tasks with the same task_number
  // instead of failing loudly enough to retry.
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_tasks_cycle_tasknum
      ON audit_tasks (audit_cycle_id, task_number);
  `);

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

/**
 * Phase 2 of docs/2026-07-22-slack-agent-roster-plan.md — has CodeRabbit
 * already produced an audit cycle for this exact repo+commit? Used to gate
 * the claudeCodeAudit.ts fallback so it only runs when CodeRabbit's webhook
 * genuinely never arrived, not as a redundant second reviewer.
 */
async function hasCodeRabbitAuditedCommit(repoFullName: string, commitSha: string): Promise<boolean> {
  // Was checking audit_cycles.audit_agent = 'coderabbit' — but
  // createAuditCycle() always writes 'claude-code' regardless of caller
  // (auditDb.ts), so CodeRabbit-sourced cycles (created via
  // processCodeRabbitPRComment.ts) never actually matched this, silently
  // making this check always return false and the CODERABBIT_FALLBACK_JOB
  // run Sentinel's redundant audit every time even when CodeRabbit had
  // already responded. Fixed 2026-07-29 (found while building D-027 item 4)
  // to check what actually distinguishes a CodeRabbit finding: the task's
  // own `source` column.
  const r = await query(`
    SELECT 1 FROM audit_tasks t
    JOIN audit_cycles c ON c.id = t.audit_cycle_id
    WHERE c.repo_full_name = $1 AND c.commit_sha = $2 AND t.source = 'coderabbit'
    LIMIT 1
  `, [repoFullName, commitSha]);
  return r.rows.length > 0;
}

/**
 * D-027 item 4 (self-review fallback) — has CodeRabbit produced ANY finding
 * for this repo since a given timestamp? Used to gate Sentinel's own
 * diff-review fallback for an open, accumulating Sentinel PR (which can span
 * many pushed commits, unlike hasCodeRabbitAuditedCommit's single-commit
 * scoping), so Sentinel only self-reviews when CodeRabbit genuinely hasn't
 * responded since the last push, not as a redundant second reviewer.
 */
async function hasCodeRabbitFindingSince(repoFullName: string, sinceIso: string): Promise<boolean> {
  const r = await query(`
    SELECT 1 FROM audit_tasks
    WHERE repo_full_name = $1 AND source = 'coderabbit' AND created_at > $2
    LIMIT 1
  `, [repoFullName, sinceIso]);
  return r.rows.length > 0;
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

/**
 * D-027 item 5 — the most recent PRIOR aspect-scoped score for this same
 * aspect, so the audit report can show a real trend ("security: 6/10, up
 * from 4/10 three sprints ago") instead of just an absolute number that
 * means nothing without history.
 */
async function getPreviousAspectHealthScore(repoFullName: string, aspect: string, excludeCycleId: number): Promise<number | null> {
  const r = await query(`
    SELECT aspect_health_score FROM audit_cycles
    WHERE repo_full_name = $1 AND aspect = $2 AND id != $3 AND aspect_health_score IS NOT NULL
    ORDER BY created_at DESC LIMIT 1
  `, [repoFullName, aspect, excludeCycleId]);
  return r.rows[0]?.aspect_health_score ?? null;
}

async function createAuditCycle(data: { repoFullName: string; commitSha: string; projectName?: string; aspect?: string }): Promise<any | null> {
  const r = await query(`
    INSERT INTO audit_cycles
      (repo_full_name, commit_sha, project_name, status, audit_agent, aspect)
    VALUES ($1,$2,$3,'auditing','claude-code',$4)
    ON CONFLICT (repo_full_name, commit_sha) DO NOTHING
    RETURNING *
  `, [data.repoFullName, data.commitSha, data.projectName, data.aspect || null]);
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

/**
 * Next task_number for a SPECIFIC audit cycle (not repo-wide — task_number
 * is scoped per cycle, enforced by idx_audit_tasks_cycle_tasknum). Used by
 * processCodeRabbitPRComment.ts where tasks are added one at a time as
 * separate webhook deliveries arrive, unlike the batch-created-once shape
 * every other audit path uses.
 */
async function getNextTaskNumberForCycle(auditCycleId: number): Promise<number> {
  const r = await query(
    `SELECT COALESCE(MAX(task_number), 0) + 1 AS next FROM audit_tasks WHERE audit_cycle_id = $1`,
    [auditCycleId]
  );
  return parseInt(r.rows[0]?.next || '1');
}

/**
 * task_number is usually pre-computed by the caller (getNextTaskNumberForCycle),
 * but that read-then-write isn't atomic: two webhook deliveries for the same
 * audit_cycle_id (e.g. two CodeRabbit PR review comments landing seconds
 * apart — confirmed live 2026-07-29) can both read the same MAX(task_number)
 * before either insert commits, so both attempts collide on
 * idx_audit_tasks_cycle_tasknum and the loser's task is silently lost —
 * fewer queued tasks ever reach taskBuilder. Retry with a freshly recomputed
 * number on that specific conflict instead of letting it bubble up as a
 * dropped task.
 */
async function createAuditTask(data: {
  auditCycleId: number; repoFullName: string; taskNumber: number;
  title: string; description?: string; priority?: string; category?: string;
  affectedFiles?: string[]; complexity?: string; safeToAutoExecute?: boolean;
  safetyReason?: string; acceptanceCriteria?: string; batchNumber?: number;
  builderAgent?: string; source?: string;
}): Promise<any | null> {
  const MAX_ATTEMPTS = 5;
  let taskNumber = data.taskNumber;
  let batchNumber = data.batchNumber;
  const batchSize = parseInt(process.env['TASK_BATCH_SIZE'] || '5');

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const r = await query(`
        INSERT INTO audit_tasks
          (audit_cycle_id, repo_full_name, task_number, title, description,
           priority, category, affected_files, complexity,
           safe_to_auto_execute, safety_reason, acceptance_criteria,
           batch_number, builder_agent, source, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'queued')
        RETURNING *
      `, [
        data.auditCycleId,      data.repoFullName,       taskNumber,
        data.title,             data.description,        data.priority,
        data.category,          data.affectedFiles || [], data.complexity,
        data.safeToAutoExecute, data.safetyReason,       data.acceptanceCriteria,
        batchNumber,            data.builderAgent || 'nvidia',
        data.source || 'sentinel',
      ]);
      return r.rows[0] || null;
    } catch (err: any) {
      const isTaskNumberConflict = err.code === '23505' &&
        String(err.constraint || '').includes('cycle_tasknum');
      if (!isTaskNumberConflict || attempt === MAX_ATTEMPTS) throw err;
      taskNumber = await getNextTaskNumberForCycle(data.auditCycleId);
      // batch_number must stay derived from the (now different) task_number —
      // otherwise a retried insert on this exact race persists a row whose
      // batch/task numbers no longer correspond, and downstream batch
      // execution (taskBuilder.ts groups by batch_number) can misassign it.
      batchNumber = Math.ceil(taskNumber / batchSize);
    }
  }
  return null;
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
  hasCodeRabbitAuditedCommit,
  hasCodeRabbitFindingSince,
  getNextTaskNumberForCycle,
  getLastCompletedAudit,
  getPreviousHealthScore,
  getPreviousAspectHealthScore,
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
