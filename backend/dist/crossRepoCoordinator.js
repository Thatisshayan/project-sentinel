"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const logger_1 = __importDefault(require("./logger"));
const repoResolver_1 = require("./repoResolver");
const DEFAULT_DEPS = {
    'session-guard': ['tapcash', 'AlphonsoEcosystem'],
    'AlphonsoEcosystem': ['tapcash', 'session-guard'],
    'shared-utils': ['tapcash', 'AlphonsoEcosystem'],
};
function getDependencyMap() {
    try {
        if (process.env['CROSS_REPO_DEPS']) {
            return JSON.parse(process.env['CROSS_REPO_DEPS']);
        }
    }
    catch (e) {
        logger_1.default.warn({ err: e.message }, 'CROSS_REPO_DEPS env var is invalid JSON — using defaults');
    }
    return DEFAULT_DEPS;
}
function getDependents(repoName) {
    const map = getDependencyMap();
    const direct = map[repoName] || [];
    const normalized = Object.entries(map).find(([k]) => k.toLowerCase() === repoName.toLowerCase());
    const extra = normalized ? normalized[1] : [];
    return [...new Set([...direct, ...extra])].filter((d) => d.toLowerCase() !== repoName.toLowerCase());
}
async function notifyDependents(pushedRepo, pushedCommitSha, authorName) {
    const dependents = getDependents(pushedRepo);
    if (dependents.length === 0)
        return;
    logger_1.default.info({ pushedRepo, dependents }, 'Cross-repo dependency triggered');
    const { triggerAudit } = require('./auditOrchestrator');
    const GITHUB_OWNER = (0, repoResolver_1.getGithubOrg)();
    for (const depRepo of dependents) {
        logger_1.default.info({ pushedRepo, depRepo }, 'Triggering dependent repo audit');
        triggerAudit({
            repoFullName: `${GITHUB_OWNER}/${depRepo}`,
            repoName: depRepo,
            projectName: depRepo,
            commitSha: `cross-repo-${pushedCommitSha.slice(0, 7)}`,
            commitMessage: `[cross-repo] Dependency ${pushedRepo} was updated by ${authorName}`,
            branchName: 'main',
            authorName: `Sentinel (cross-repo from ${pushedRepo})`,
            authorEmail: 'sentinel@project-sentinel.app',
            topicId: null,
        }).catch((err) => logger_1.default.warn({ depRepo, err: err.message }, 'Cross-repo audit trigger failed — non-blocking'));
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}
function describeDependencies() {
    const map = getDependencyMap();
    if (!Object.keys(map).length)
        return 'No cross-repo dependencies configured.';
    return Object.entries(map)
        .map(([k, v]) => `${k} → ${v.join(', ')}`)
        .join('\n');
}
module.exports = { notifyDependents, getDependents, describeDependencies };
//# sourceMappingURL=crossRepoCoordinator.js.map