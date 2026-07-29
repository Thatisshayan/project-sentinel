import dbClient from './dbClient';
import logger from './logger';

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
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

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

async function updateProject(pageId: string, data: any): Promise<void> {
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

async function appendProjectChangelog(pageId: string, data: any): Promise<void> {
  const {
    commitTimestamp, projectName, repoName,
    branchName, commitSha, authorName,
    commitMessage, filesChangedCount,
    isMarketingOnlyUpdate, commitUrl, riskLevel,
  } = data;

  const dateStr  = new Date(commitTimestamp).toUTCString();
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
    return id;
  }
  logger.info({ repoName, id }, 'Project record created');
  return id;
}

export = {
  initProjectSchema, findProject, updateProject,
  appendProjectChangelog, updateProjectBuilderAgent, createProject,
};
