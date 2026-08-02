import dbClient from './dbClient';
import logger from './logger';
import { ensureProject } from './boardroomDb';

const { query } = dbClient;

/**
 * Self-hosted replacement for the Notion "project database" (see D-025 in
 * docs/governance/DEFERRED_WORK.md). notionClient.ts's exported function
 * signatures are kept identical and now delegate here, so the 8 call sites
 * that import notionClient.ts didn't need to change.
 */
async function initProjectSchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS projects (
      id                 TEXT PRIMARY KEY,
      repo_name          TEXT NOT NULL UNIQUE,
      project_name       TEXT NOT NULL,
      url                TEXT,
      builder_agent      TEXT,
      topic_id           TEXT,
      priority           TEXT,
      last_commit_message   TEXT,
      last_commit_hash      TEXT,
      last_commit_url       TEXT,
      last_branch           TEXT,
      last_commit_author    TEXT,
      last_commit_date      TIMESTAMPTZ,
      changed_files         TEXT,
      files_changed_count   INTEGER,
      risk_level            TEXT,
      deployment_status     TEXT,
      build_provider        TEXT,
      build_url             TEXT,
      current_project_state TEXT,
      last_build_error      TEXT,
      high_risk             TEXT,
      high_risk_reason      TEXT,
      active_task_branch    TEXT,
      active_pr_url         TEXT,
      active_pr_number      INTEGER,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // D-027 item 1/2 predecessor — item 3 (same-PR patch loop): a repo's
  // accumulating Sentinel branch/PR, so batches reuse one branch instead of
  // each batch opening a brand-new PR. Added via ALTER for tables that
  // already existed before this column was introduced (2026-07-29).
  await query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS active_task_branch TEXT;`);
  await query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS active_pr_url TEXT;`);
  await query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS active_pr_number INTEGER;`);

  // D-027 item 5 (multi-aspect audit + scoring + rotation) — which aspect
  // (security, frontend, backend, ...) the repo's audits are currently
  // focused on, and how many sprints (audit cycles) it's had in that aspect
  // so far. See auditAspects.ts for the rotation policy.
  await query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS current_audit_aspect TEXT;`);
  await query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS aspect_sprint_count INTEGER NOT NULL DEFAULT 0;`);

  await query(`
    CREATE TABLE IF NOT EXISTS project_changelog (
      id          SERIAL PRIMARY KEY,
      project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      entry       TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  logger.info('Project schema initialised');
}

function toId(repoName: string): string {
  return repoName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function findProject(repoName: string): Promise<{
  pageId: string; projectName: string; url: string | null;
  builderAgent: string | null; topicId: string | null;
} | null> {
  const r = await query('SELECT * FROM projects WHERE id = $1', [toId(repoName)]);
  const row = r.rows[0];
  if (!row) {
    logger.warn({ repoName }, 'Project not found in local registry — was it onboarded?');
    return null;
  }
  // toId() collapses non-alphanumeric chars to '-', so distinct repo names
  // (e.g. 'my-app' vs 'my_app') can alias onto the same id — confirmed by
  // CodeRabbit 2026-07-29. Refuse to hand back another repo's project data
  // rather than silently misattributing builderAgent/url/topicId.
  if (row.repo_name.toLowerCase() !== repoName.toLowerCase()) {
    logger.error({ repoName, id: toId(repoName), collidedWith: row.repo_name },
      'toId collision — stored repo_name does not match requested repo, refusing to return it');
    return null;
  }
  return {
    pageId:       row.id,
    projectName:  row.project_name,
    url:          row.url,
    builderAgent: row.builder_agent,
    topicId:      row.topic_id,
  };
}

interface ProjectUpdateData {
  commitMessage?: string;
  commitSha?: string;
  commitUrl?: string;
  branchName?: string;
  authorName?: string;
  commitTimestamp?: string;
  changedFilesText?: string;
  filesChangedCount?: number;
  riskLevel?: string;
  deploymentStatus?: string;
  buildProvider?: string;
  buildUrl?: string | null;
  currentProjectState?: string;
  lastBuildError?: string;
  highRiskFlag?: string;
  highRiskReason?: string;
}

async function updateProject(pageId: string, data: ProjectUpdateData): Promise<void> {
  const {
    commitMessage, commitSha, commitUrl,
    branchName, authorName, commitTimestamp,
    changedFilesText, filesChangedCount, riskLevel,
    deploymentStatus, buildProvider, buildUrl,
    currentProjectState, lastBuildError,
    highRiskFlag, highRiskReason,
  } = data;

  await query(`
    UPDATE projects SET
      last_commit_message   = COALESCE($2, last_commit_message),
      last_commit_hash      = COALESCE($3, last_commit_hash),
      last_commit_url       = COALESCE($4, last_commit_url),
      last_branch           = COALESCE($5, last_branch),
      last_commit_author    = COALESCE($6, last_commit_author),
      last_commit_date      = COALESCE($7, last_commit_date),
      changed_files         = COALESCE($8, changed_files),
      files_changed_count   = COALESCE($9, files_changed_count),
      risk_level            = COALESCE($10, risk_level),
      deployment_status     = COALESCE($11, deployment_status),
      build_provider        = COALESCE($12, build_provider),
      build_url             = COALESCE($13, build_url),
      current_project_state = COALESCE($14, current_project_state),
      last_build_error      = COALESCE($15, last_build_error),
      high_risk             = COALESCE($16, high_risk),
      high_risk_reason      = COALESCE($17, high_risk_reason),
      updated_at            = NOW()
    WHERE id = $1
  `, [
    pageId, commitMessage, commitSha, commitUrl, branchName, authorName,
    commitTimestamp || null, changedFilesText, filesChangedCount ?? null, riskLevel,
    deploymentStatus, buildProvider, buildUrl, currentProjectState, lastBuildError,
    highRiskFlag, highRiskReason,
  ]);
  logger.info({ pageId }, 'Project record updated');
}

interface ChangelogData {
  commitTimestamp?: string;
  projectName?: string;
  repoName?: string;
  branchName?: string;
  commitSha?: string;
  authorName?: string;
  commitMessage?: string;
  filesChangedCount?: number;
  isMarketingOnlyUpdate?: boolean;
  commitUrl?: string;
  riskLevel?: string;
}

async function appendProjectChangelog(pageId: string, data: ChangelogData): Promise<void> {
  const {
    commitTimestamp, projectName, repoName,
    branchName, commitSha, authorName,
    commitMessage, filesChangedCount,
    isMarketingOnlyUpdate, commitUrl, riskLevel,
  } = data;

  const dateStr  = new Date(commitTimestamp || Date.now()).toUTCString();
  const shortSha = (commitSha || '').substring(0, 7);

  const entry =
`Sentinel Update — ${dateStr}

Project: ${projectName || repoName}
Repo: ${repoName}
Branch: ${branchName}
Commit: ${shortSha}
Author: ${authorName}
Message: ${commitMessage}
Files Changed: ${filesChangedCount}
Risk: ${riskLevel}
Marketing Update: ${isMarketingOnlyUpdate ? 'Yes' : 'No'}
Commit URL: ${commitUrl}`;

  await query(
    'INSERT INTO project_changelog (project_id, entry) VALUES ($1, $2)',
    [pageId, entry]
  );
}

async function updateProjectBuilderAgent(pageId: string, agentId: string): Promise<void> {
  await query('UPDATE projects SET builder_agent = $2, updated_at = NOW() WHERE id = $1', [pageId, agentId]);
}

async function createProject(data: { repoName: string; priority?: string; builderAgent?: string }): Promise<string | null> {
  const { repoName, priority, builderAgent } = data;
  const id = toId(repoName);
  const r = await query(`
    INSERT INTO projects (id, repo_name, project_name, priority, builder_agent)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `, [id, repoName, repoName, priority || null, builderAgent || null]);

  if (!r.rows[0]) {
    // ON CONFLICT fired — either this repo really was already onboarded, or
    // toId() aliased it onto a different repo's row (e.g. 'my-app' vs
    // 'my_app'). Verify before treating it as "already exists".
    const existing = await query('SELECT repo_name FROM projects WHERE id = $1', [id]);
    if (existing.rows[0] && existing.rows[0].repo_name.toLowerCase() !== repoName.toLowerCase()) {
      logger.error({ repoName, id, collidedWith: existing.rows[0].repo_name },
        'toId collision — refusing to create project, another repo already owns this id');
      return null;
    }
    logger.warn({ repoName }, 'Project already exists — not recreating');
    await ensureProject({ repoFullName: repoName, repoName, displayName: repoName, priority: priority || 'medium' }).catch(() => null);
    return id;
  }
  logger.info({ repoName, id }, 'Project record created');
  await ensureProject({ repoFullName: repoName, repoName, displayName: repoName, priority: priority || 'medium' }).catch(() => null);
  return id;
}

async function getActiveTaskBranch(repoName: string): Promise<{
  branch: string; prUrl: string | null; prNumber: number | null;
} | null> {
  const id = toId(repoName);
  const r = await query(
    'SELECT repo_name, active_task_branch, active_pr_url, active_pr_number FROM projects WHERE id = $1',
    [id]
  );
  const row = r.rows[0];
  if (!row || !row.active_task_branch) return null;
  // Same toId() collision guard as findProject — never hand back another
  // repo's accumulating branch/PR because two repo names collapsed to the
  // same id.
  if (row.repo_name.toLowerCase() !== repoName.toLowerCase()) {
    logger.error({ repoName, id, collidedWith: row.repo_name },
      'toId collision — refusing to return active task branch for a different repo');
    return null;
  }
  return {
    branch:   row.active_task_branch,
    prUrl:    row.active_pr_url,
    prNumber: row.active_pr_number,
  };
}

async function setActiveTaskBranch(repoName: string, branch: string, prUrl: string | null, prNumber: number | null): Promise<void> {
  const id = toId(repoName);
  await query(`
    INSERT INTO projects (id, repo_name, project_name, active_task_branch, active_pr_url, active_pr_number)
    VALUES ($1, $2, $2, $3, $4, $5)
    ON CONFLICT (id) DO UPDATE SET
      active_task_branch = EXCLUDED.active_task_branch,
      active_pr_url      = EXCLUDED.active_pr_url,
      active_pr_number   = EXCLUDED.active_pr_number,
      updated_at         = NOW()
    WHERE projects.repo_name = $2
  `, [id, repoName, branch, prUrl, prNumber]);
  logger.info({ repoName, branch, prNumber }, 'Active task branch recorded');
}

async function clearActiveTaskBranch(repoName: string): Promise<void> {
  const id = toId(repoName);
  await query(`
    UPDATE projects SET
      active_task_branch = NULL, active_pr_url = NULL, active_pr_number = NULL,
      updated_at = NOW()
    WHERE id = $1 AND repo_name = $2
  `, [id, repoName]);
  logger.info({ repoName }, 'Active task branch cleared');
}

async function getAspectState(repoName: string): Promise<{ aspect: string; sprintCount: number } | null> {
  const id = toId(repoName);
  const r = await query(
    'SELECT repo_name, current_audit_aspect, aspect_sprint_count FROM projects WHERE id = $1',
    [id]
  );
  const row = r.rows[0];
  if (!row || !row.current_audit_aspect) return null;
  if (row.repo_name.toLowerCase() !== repoName.toLowerCase()) {
    logger.error({ repoName, id, collidedWith: row.repo_name },
      'toId collision — refusing to return aspect state for a different repo');
    return null;
  }
  return { aspect: row.current_audit_aspect, sprintCount: row.aspect_sprint_count };
}

async function setAspectState(repoName: string, aspect: string, sprintCount: number): Promise<void> {
  const id = toId(repoName);
  await query(`
    INSERT INTO projects (id, repo_name, project_name, current_audit_aspect, aspect_sprint_count)
    VALUES ($1, $2, $2, $3, $4)
    ON CONFLICT (id) DO UPDATE SET
      current_audit_aspect = EXCLUDED.current_audit_aspect,
      aspect_sprint_count  = EXCLUDED.aspect_sprint_count,
      updated_at           = NOW()
    WHERE projects.repo_name = $2
  `, [id, repoName, aspect, sprintCount]);
}

export = {
  initProjectSchema, findProject, updateProject,
  appendProjectChangelog, updateProjectBuilderAgent, createProject,
  getActiveTaskBranch, setActiveTaskBranch, clearActiveTaskBranch,
  getAspectState, setAspectState,
};
