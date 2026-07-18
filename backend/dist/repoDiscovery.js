"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const safeFire_1 = require("./utils/safeFire");
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("./logger"));
const repoResolver_1 = require("./repoResolver");
const repoOnboarder_1 = require("./repoOnboarder");
const portfolioAnalytics_1 = require("./portfolioAnalytics");
const portfolioDb_1 = require("./portfolioDb");
const SELF_REPOS = ['project-sentinel', 'sentinel-ui'];
const BASELINE_MARKER = '__sentinel_baseline_seeded__';
async function listAllOwnedRepos() {
    const token = process.env['GITHUB_TOKEN'];
    if (!token)
        return [];
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
    const org = (0, repoResolver_1.getGithubOrg)();
    const repos = [];
    let page = 1;
    while (true) {
        const res = await axios_1.default.get('https://api.github.com/user/repos', {
            headers,
            timeout: 10000,
            params: { affiliation: 'owner', per_page: 100, page, sort: 'created', direction: 'desc' },
        });
        if (!res.data.length)
            break;
        repos.push(...res.data);
        if (res.data.length < 100)
            break;
        page++;
        if (page > 10)
            break;
    }
    return repos.filter((r) => r.owner?.login?.toLowerCase() === org.toLowerCase());
}
async function discoverAndOnboardRepos() {
    if (!process.env['GITHUB_TOKEN']) {
        logger_1.default.warn('GITHUB_TOKEN not set — repo discovery skipped');
        return { discovered: 0 };
    }
    let ghRepos;
    try {
        ghRepos = await listAllOwnedRepos();
    }
    catch (err) {
        logger_1.default.error({ err: err.stack ?? err.message }, 'Repo discovery: GitHub list failed');
        return { discovered: 0, error: err.message };
    }
    const previouslyKnown = await (0, portfolioDb_1.getDiscoveredRepoNames)();
    const isFirstRun = !previouslyKnown.includes(BASELINE_MARKER);
    const known = new Set([
        ...(0, repoOnboarder_1.getWatchedRepos)().map((r) => r.toLowerCase()),
        ...previouslyKnown.map((r) => r.toLowerCase()),
        ...SELF_REPOS.map((r) => r.toLowerCase()),
    ]);
    const newRepos = ghRepos.filter((r) => !known.has(r.name.toLowerCase()));
    if (isFirstRun) {
        logger_1.default.info({ count: newRepos.length, repos: newRepos.map((r) => r.name) }, 'Repo discovery: first run — seeding baseline without onboarding (these repos already existed)');
        for (const repo of newRepos) {
            await (0, portfolioDb_1.insertDiscoveredRepo)({
                repoName: repo.name, repoFullName: repo.full_name,
                githubId: repo.id, isPrivate: repo.private,
            }).catch((err) => logger_1.default.warn({ err: err.message, repoName: repo.name }, 'Baseline seed failed'));
        }
        await (0, portfolioDb_1.insertDiscoveredRepo)({
            repoName: BASELINE_MARKER, repoFullName: 'internal/baseline-marker',
            githubId: 0, isPrivate: true,
        }).catch((err) => logger_1.default.error({ err: err.stack ?? err.message }, 'Failed to write baseline marker — discovery will re-seed next run'));
        return { discovered: 0, seeded: newRepos.length };
    }
    if (newRepos.length === 0) {
        logger_1.default.info({ scanned: ghRepos.length }, 'Repo discovery: no new repos found');
        return { discovered: 0 };
    }
    logger_1.default.info({ count: newRepos.length, repos: newRepos.map((r) => r.name) }, 'Repo discovery: new repos found');
    for (const repo of newRepos) {
        try {
            await (0, portfolioDb_1.insertDiscoveredRepo)({
                repoName: repo.name,
                repoFullName: repo.full_name,
                githubId: repo.id,
                isPrivate: repo.private,
            });
            await (0, repoOnboarder_1.onboardRepo)(repo.name);
            await (0, portfolioDb_1.markDiscoveredRepoOnboarded)(repo.name);
        }
        catch (err) {
            logger_1.default.error({ err: err.stack ?? err.message, repoName: repo.name }, 'Repo discovery: onboarding failed');
            await (0, safeFire_1.safeFire)((0, portfolioDb_1.markDiscoveredRepoOnboarded)(repo.name, err.message), { label: 'repoDiscovery' });
        }
    }
    return { discovered: newRepos.length, repos: newRepos.map((r) => r.name) };
}
async function getFullRepoList() {
    const dynamic = await (0, portfolioDb_1.getOnboardedDiscoveredRepos)().catch(() => []);
    const known = new Set(portfolioAnalytics_1.REPO_LIST.map((r) => r.repoName));
    return [...portfolioAnalytics_1.REPO_LIST, ...dynamic.filter((r) => !known.has(r.repoName))];
}
module.exports = { discoverAndOnboardRepos, getFullRepoList, listAllOwnedRepos };
//# sourceMappingURL=repoDiscovery.js.map