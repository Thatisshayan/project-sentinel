const axios  = require('axios');
const logger = require('./logger');
const { getGithubOrg }      = require('./repoResolver');
const { getWatchedRepos, onboardRepo } = require('./repoOnboarder');
const { REPO_LIST }         = require('./portfolioAnalytics');
const {
  getDiscoveredRepoNames,
  getOnboardedDiscoveredRepos,
  insertDiscoveredRepo,
  markDiscoveredRepoOnboarded,
} = require('./portfolioDb');

// Sentinel's own repo — never onboard itself as a "new" repo to track.
const SELF_REPO = 'project-sentinel';

// Lists every repo the GITHUB_TOKEN's owner can see (public + private),
// paginated. Works whether GITHUB_ORG is a personal account or a real org —
// GitHub's /user/repos endpoint returns repos owned by the authenticated
// user regardless, which is what this project's token actually is.
async function listAllOwnedRepos() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return [];

  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  const org     = getGithubOrg();
  const repos   = [];
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
    if (page > 10) break; // hard cap — 1000 repos is far beyond this project's scale
  }

  // Only repos actually under the configured org/owner login.
  return repos.filter(r => r.owner?.login?.toLowerCase() === org.toLowerCase());
}

// Scans GitHub for repos not yet known to Sentinel (static WATCHED_REPOS list,
// previously-discovered repos, or Sentinel itself) and onboards each one:
// Notion row + GitHub webhook + first audit + Telegram announcement.
async function discoverAndOnboardRepos() {
  if (!process.env.GITHUB_TOKEN) {
    logger.warn('GITHUB_TOKEN not set — repo discovery skipped');
    return { discovered: 0 };
  }

  let ghRepos;
  try {
    ghRepos = await listAllOwnedRepos();
  } catch (err) {
    logger.error({ err: err.message }, 'Repo discovery: GitHub list failed');
    return { discovered: 0, error: err.message };
  }

  const known = new Set([
    ...getWatchedRepos().map(r => r.toLowerCase()),
    ...(await getDiscoveredRepoNames()).map(r => r.toLowerCase()),
    SELF_REPO.toLowerCase(),
  ]);

  const newRepos = ghRepos.filter(r => !known.has(r.name.toLowerCase()));

  if (newRepos.length === 0) {
    logger.info({ scanned: ghRepos.length }, 'Repo discovery: no new repos found');
    return { discovered: 0 };
  }

  logger.info({ count: newRepos.length, repos: newRepos.map(r => r.name) }, 'Repo discovery: new repos found');

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
    } catch (err) {
      logger.error({ err: err.message, repoName: repo.name }, 'Repo discovery: onboarding failed');
      await markDiscoveredRepoOnboarded(repo.name, err.message).catch(() => {});
    }
  }

  return { discovered: newRepos.length, repos: newRepos.map(r => r.name) };
}

// Full tracked repo list for metrics/priority loops: static REPO_LIST plus
// every dynamically-discovered repo that onboarded successfully.
async function getFullRepoList() {
  const dynamic = await getOnboardedDiscoveredRepos().catch(() => []);
  const known   = new Set(REPO_LIST.map(r => r.repoName));
  return [...REPO_LIST, ...dynamic.filter(r => !known.has(r.repoName))];
}

module.exports = { discoverAndOnboardRepos, getFullRepoList, listAllOwnedRepos };
