const logger = require('./logger');
const { getGithubOrg } = require('./repoResolver');

// Dependency graph: when repo A changes, repo B should be re-audited.
// Configurable via CROSS_REPO_DEPS env var (JSON) or the defaults below.
//
// Format: { "repoA": ["repoB", "repoC"], ... }
//
// Examples:
//   session-guard changes → tapcash + AlphonsoEcosystem should re-audit
//   shared-utils changes → all dependent repos should re-audit

const DEFAULT_DEPS = {
  'session-guard':      ['tapcash', 'AlphonsoEcosystem'],
  'AlphonsoEcosystem':  ['tapcash', 'session-guard'],
  'shared-utils':       ['tapcash', 'AlphonsoEcosystem'],
};

function getDependencyMap() {
  try {
    if (process.env.CROSS_REPO_DEPS) {
      return JSON.parse(process.env.CROSS_REPO_DEPS);
    }
  } catch (e) {
    logger.warn({ err: e.message }, 'CROSS_REPO_DEPS env var is invalid JSON — using defaults');
  }
  return DEFAULT_DEPS;
}

// Returns list of repo names that should be checked when repoName is pushed to.
function getDependents(repoName) {
  const map    = getDependencyMap();
  const direct = map[repoName] || [];

  // Also normalize: try lowercase + title case matches
  const normalized = Object.entries(map).find(
    ([k]) => k.toLowerCase() === repoName.toLowerCase()
  );
  const extra = normalized ? normalized[1] : [];

  return [...new Set([...direct, ...extra])].filter(d =>
    d.toLowerCase() !== repoName.toLowerCase()
  );
}

// Called from webhook.js after a push is processed.
// Triggers audits for dependent repos without blocking the push response.
async function notifyDependents(pushedRepo, pushedCommitSha, authorName) {
  const dependents = getDependents(pushedRepo);
  if (dependents.length === 0) return;

  logger.info({ pushedRepo, dependents }, 'Cross-repo dependency triggered');

  const { triggerAudit } = require('./auditOrchestrator');
  const GITHUB_OWNER = getGithubOrg();

  for (const depRepo of dependents) {
    logger.info({ pushedRepo, depRepo }, 'Triggering dependent repo audit');
    triggerAudit({
      repoFullName:  `${GITHUB_OWNER}/${depRepo}`,
      repoName:      depRepo,
      projectName:   depRepo,
      commitSha:     `cross-repo-${pushedCommitSha.slice(0, 7)}`,
      commitMessage: `[cross-repo] Dependency ${pushedRepo} was updated by ${authorName}`,
      branchName:    'main',
      authorName:    `Sentinel (cross-repo from ${pushedRepo})`,
      authorEmail:   'sentinel@project-sentinel.app',
      topicId:       null,
    }).catch(err =>
      logger.warn({ depRepo, err: err.message }, 'Cross-repo audit trigger failed — non-blocking')
    );

    // Small delay to avoid hammering the audit system
    await new Promise(r => setTimeout(r, 2000));
  }
}

// Returns the full dependency map as a human-readable string for /sentinel commands
function describeDependencies() {
  const map = getDependencyMap();
  if (!Object.keys(map).length) return 'No cross-repo dependencies configured.';
  return Object.entries(map)
    .map(([k, v]) => `${k} → ${v.join(', ')}`)
    .join('\n');
}

module.exports = { notifyDependents, getDependents, describeDependencies };
