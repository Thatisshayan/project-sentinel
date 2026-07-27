import logger from './logger';
import { getGithubOrg } from './repoResolver';
import { getDefaultBranch } from './repoDiscovery';

const DEFAULT_DEPS: Record<string, string[]> = {
  'session-guard':      ['tapcash', 'AlphonsoEcosystem'],
  'AlphonsoEcosystem':  ['tapcash', 'session-guard'],
  'shared-utils':       ['tapcash', 'AlphonsoEcosystem'],
};

function getDependencyMap(): Record<string, string[]> {
  try {
    if (process.env['CROSS_REPO_DEPS']) {
      return JSON.parse(process.env['CROSS_REPO_DEPS']);
    }
  } catch (e: any) {
    logger.warn({ err: e.message }, 'CROSS_REPO_DEPS env var is invalid JSON — using defaults');
  }
  return DEFAULT_DEPS;
}

function getDependents(repoName: string): string[] {
  const map    = getDependencyMap();
  const direct = map[repoName] || [];

  const normalized = Object.entries(map).find(
    ([k]: [string, string[]]) => k.toLowerCase() === repoName.toLowerCase()
  );
  const extra = normalized ? normalized[1] : [];

  return [...new Set([...direct, ...extra])].filter((d: string) =>
    d.toLowerCase() !== repoName.toLowerCase()
  );
}

async function notifyDependents(pushedRepo: string, pushedCommitSha: string, authorName: string): Promise<void> {
  const dependents = getDependents(pushedRepo);
  if (dependents.length === 0) return;

  logger.info({ pushedRepo, dependents }, 'Cross-repo dependency triggered');

  const { triggerAudit } = require('./auditOrchestrator') as { triggerAudit: (...args: any[]) => Promise<any> };
  const { getDefaultBranch } = require('./repoDiscovery') as { getDefaultBranch: (r: string) => Promise<string> };
  const GITHUB_OWNER = getGithubOrg();

  for (const depRepo of dependents) {
    logger.info({ pushedRepo, depRepo }, 'Triggering dependent repo audit');
    const branchName = await getDefaultBranch(`${GITHUB_OWNER}/${depRepo}`).catch(() => 'main');
    triggerAudit({
      repoFullName:  `${GITHUB_OWNER}/${depRepo}`,
      repoName:      depRepo,
      projectName:   depRepo,
      commitSha:     `cross-repo-${pushedCommitSha.slice(0, 7)}`,
      commitMessage: `[cross-repo] Dependency ${pushedRepo} was updated by ${authorName}`,
      branchName,
      authorName:    `Sentinel (cross-repo from ${pushedRepo})`,
      authorEmail:   'sentinel@project-sentinel.app',
      topicId:       null,
    }).catch((err: any) =>
      logger.warn({ depRepo, err: err.message }, 'Cross-repo audit trigger failed — non-blocking')
    );

    await new Promise<void>(resolve => setTimeout(resolve, 2000));
  }
}

function describeDependencies(): string {
  const map = getDependencyMap();
  if (!Object.keys(map).length) return 'No cross-repo dependencies configured.';
  return Object.entries(map)
    .map(([k, v]: [string, string[]]) => `${k} → ${v.join(', ')}`)
    .join('\n');
}

export = { notifyDependents, getDependents, describeDependencies };
