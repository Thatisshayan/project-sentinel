import axios from 'axios';
import logger from './logger';
import { getGithubOrg } from './repoResolver';
import { getWatchedRepos, onboardRepo } from './repoOnboarder';
import { REPO_LIST } from './portfolioAnalytics';
import { getDiscoveredRepoNames, getOnboardedDiscoveredRepos, insertDiscoveredRepo, markDiscoveredRepoOnboarded } from './portfolioDb';

const SELF_REPOS: string[] = ['project-sentinel', 'sentinel-ui'];

const BASELINE_MARKER = '__sentinel_baseline_seeded__';

async function listAllOwnedRepos(): Promise<any[]> {
  const token = process.env['GITHUB_TOKEN'];
  if (!token) return [];

  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  const org     = getGithubOrg();
  const repos: any[]   = [];
  let page = 1;

  while (true) {
    const res = await axios.get('https://api.github.com/user/repos', {
      headers,
      timeout: 10000,
      params: { affiliation: 'owner', per_page: 100, page, sort: 'created', direction: 'desc' },
    });
    if (!res.data.length) break;
    repos.push(...res.data);
    if (res.data.length < 100) break;
    page++;
    if (page > 10) break;
  }

  return repos.filter((r: any) => r.owner?.login?.toLowerCase() === org.toLowerCase());
}

async function discoverAndOnboardRepos(): Promise<{ discovered: number; repos?: string[]; seeded?: number; error?: string }> {
  if (!process.env['GITHUB_TOKEN']) {
    logger.warn('GITHUB_TOKEN not set — repo discovery skipped');
    return { discovered: 0 };
  }

  let ghRepos: any[];
  try {
    ghRepos = await listAllOwnedRepos();
  } catch (err: any) {
    logger.error({ err: err.stack ?? err.message }, 'Repo discovery: GitHub list failed');
    return { discovered: 0, error: err.message };
  }

  const previouslyKnown = await getDiscoveredRepoNames();
  const isFirstRun = !previouslyKnown.includes(BASELINE_MARKER);

  const known = new Set([
    ...getWatchedRepos().map((r: string) => r.toLowerCase()),
    ...previouslyKnown.map((r: string) => r.toLowerCase()),
    ...SELF_REPOS.map((r: string) => r.toLowerCase()),
  ]);

  const newRepos = ghRepos.filter((r: any) => !known.has(r.name.toLowerCase()));

  if (isFirstRun) {
    logger.info(
      { count: newRepos.length, repos: newRepos.map((r: any) => r.name) },
      'Repo discovery: first run — seeding baseline without onboarding (these repos already existed)'
    );
    for (const repo of newRepos) {
      await insertDiscoveredRepo({
        repoName: repo.name, repoFullName: repo.full_name,
        githubId: repo.id,   isPrivate: repo.private,
      }).catch((err: any) => logger.warn({ err: err.message, repoName: repo.name }, 'Baseline seed failed'));
    }
    await insertDiscoveredRepo({
      repoName: BASELINE_MARKER, repoFullName: 'internal/baseline-marker',
      githubId: 0, isPrivate: true,
    }).catch((err: any) => logger.error({ err: err.stack ?? err.message }, 'Failed to write baseline marker — discovery will re-seed next run'));
    return { discovered: 0, seeded: newRepos.length };
  }

  if (newRepos.length === 0) {
    logger.info({ scanned: ghRepos.length }, 'Repo discovery: no new repos found');
    return { discovered: 0 };
  }

  logger.info({ count: newRepos.length, repos: newRepos.map((r: any) => r.name) }, 'Repo discovery: new repos found');

  for (const repo of newRepos) {
    try {
      await insertDiscoveredRepo({
        repoName:     repo.name,
        repoFullName: repo.full_name,
        githubId:     repo.id,
        isPrivate:    repo.private,
      });
      await onboardRepo(repo.name);
      await markDiscoveredRepoOnboarded(repo.name);
    } catch (err: any) {
      logger.error({ err: err.stack ?? err.message, repoName: repo.name }, 'Repo discovery: onboarding failed');
      await markDiscoveredRepoOnboarded(repo.name, err.message).catch(() => {});
    }
  }

  return { discovered: newRepos.length, repos: newRepos.map((r: any) => r.name) };
}

async function getFullRepoList(): Promise<Array<{ repoName: string; repoFullName: string }>> {
  const dynamic = await getOnboardedDiscoveredRepos().catch(() => []);
  const known   = new Set(REPO_LIST.map((r: any) => r.repoName));
  return [...REPO_LIST, ...dynamic.filter((r: any) => !known.has(r.repoName))];
}

export = { discoverAndOnboardRepos, getFullRepoList, listAllOwnedRepos };

