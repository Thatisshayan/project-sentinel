"use strict";
function getGithubOrg() {
    const org = process.env['GITHUB_ORG']?.trim();
    if (!org)
        throw new Error('GITHUB_ORG env var is required');
    return org;
}
function repoFullName(repoName) {
    return `${getGithubOrg()}/${repoName}`;
}
function canonicalizeRepoName(input) {
    if (!input)
        return null;
    // lazy require — portfolioAnalytics requires this module for repoFullName()
    const { REPO_LIST } = require('./portfolioAnalytics');
    const ALL_REPOS = [...REPO_LIST, { repoName: 'project-sentinel', repoFullName: repoFullName('project-sentinel') }];
    const normalize = (s) => s.toLowerCase().replace(/[-_\s]/g, '');
    const inputNorm = normalize(input);
    return ALL_REPOS.find((r) => normalize(r.repoName) === inputNorm) || null;
}
module.exports = { getGithubOrg, repoFullName, canonicalizeRepoName };
//# sourceMappingURL=repoResolver.js.map