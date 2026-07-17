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

// Sentinel's own infrastructure — never auto-onboard these as "tracked repos"
// to audit/build against. Add any other Sentinel-adjacent service here.
const SELF_REPOS = ['project-sentinel', 'sentinel-ui'];

// Marker row (not a real repo) recording "the one-time baseline seed has
// run". Deliberately NOT "is discovered_repos empty" — a botched first
// deploy of this feature already inserted a couple of real rows before this
// safety check existed, so an emptiness check would wrongly skip baseline
// seeding and auto-onboard everything else that leaked through.
const BASELINE_MARKER = '__sentinel_baseline_seeded__';

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

  // eslint-disable-next-line no-constant-condition
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

// Scans GitHub for repos not yet known to Sentinel and onboards genuinely
// NEW ones: Notion row + GitHub webhook + first audit + Telegram announcement.
//
// Safety: the very first time this ever runs, `discovered_repos` is empty —
// that must NOT be read as "every repo on the account is new". Doing so once
// mass-onboarded 20 unrelated personal repos (including Sentinel's own
// sibling service) the moment this feature shipped. So the first run instead
// seeds every repo it currently sees as "known" WITHOUT onboarding anything;
// only repos that show up in a *later* scan (i.e. actually created after
// Sentinel started watching) get auto-onboarded.
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

  const previouslyKnown = await getDiscoveredRepoNames();
  const isFirstRun = !previouslyKnown.includes(BASELINE_MARKER);

  const known = new Set([
    ...getWatchedRepos().map(r => r.toLowerCase()),
    ...previouslyKnown.map(r => r.toLowerCase()),
    ...SELF_REPOS.map(r => r.toLowerCase()),
  ]);

  const newRepos = ghRepos.filter(r => !known.has(r.name.toLowerCase()));

  if (isFirstRun) {
    logger.info(
      { count: newRepos.length, repos: newRepos.map(r => r.name) },
      'Repo discovery: first run — seeding baseline without onboarding (these repos already existed)'
    );
    for (const repo of newRepos) {
      await insertDiscoveredRepo({
        repoName: repo.name, repoFullName: repo.full_name,
        githubId: repo.id,   isPrivate: repo.private,
      }).catch(err => logger.warn({ err: err.message, repoName: repo.name }, 'Baseline seed failed'));
    }
    await insertDiscoveredRepo({
      repoName: BASELINE_MARKER, repoFullName: 'internal/baseline-marker',
      githubId: 0, isPrivate: true,
    }).catch(err => logger.error({ err: err.message }, 'Failed to write baseline marker — discovery will re-seed next run'));
    return { discovered: 0, seeded: newRepos.length };
  }

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
