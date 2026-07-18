"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const safeFire_1 = require("./utils/safeFire");
const logger_1 = __importDefault(require("./logger"));
const agentDb_1 = require("./agentDb");
const agentRoom_1 = require("./agentRoom");
const repoResolver_1 = require("./repoResolver");
const DEPENDENT_REPOS = [
    [(0, repoResolver_1.repoFullName)('AlphonsoEcosystem'), (0, repoResolver_1.repoFullName)('session-guard')],
];
const pendingConflicts = new Map();
async function checkAndLockFiles(repoFullName, filePaths, agentId, agentLabel, taskId) {
    await (0, safeFire_1.safeFire)((0, agentDb_1.releaseExpiredLocks)(), { label: 'conflictDetector' });
    if (!filePaths || filePaths.length === 0) {
        return { canProceed: true, conflicts: [], acquired: [] };
    }
    const { acquired, conflicts } = await (0, agentDb_1.acquireFileLocks)(repoFullName, filePaths, agentId, Number(taskId));
    if (conflicts.length > 0) {
        const conflictId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        pendingConflicts.set(conflictId, {
            repoFullName, agentId, agentLabel, filePaths, taskId, conflicts,
            createdAt: Date.now(),
        });
        setTimeout(() => pendingConflicts.delete(conflictId), 30 * 60 * 1000);
        const repoName = repoFullName.split('/')[1] || '';
        await (0, agentRoom_1.sendConflictKeyboard)(agentId, agentLabel, repoName, conflicts, conflictId);
        await (0, agentRoom_1.announceConflict)(agentId, agentLabel, repoName, conflicts);
    }
    const canProceed = acquired.length > 0 || filePaths.length === 0;
    return { canProceed, conflicts, acquired };
}
async function releaseAllLocks(repoFullName, agentId) {
    const released = await (0, agentDb_1.releaseFileLocks)(repoFullName, agentId);
    logger_1.default.info({ repoFullName, agentId, count: released.length }, 'File locks released');
    return released;
}
function getDependentRepos(repoFullName) {
    for (const pair of DEPENDENT_REPOS) {
        if (pair.includes(repoFullName)) {
            return pair.filter((r) => r !== repoFullName);
        }
    }
    return [];
}
async function checkDependencyConflicts(repoFullName) {
    const dependents = getDependentRepos(repoFullName);
    if (dependents.length === 0)
        return { hasConflict: false };
    const active = await (0, agentDb_1.getActiveAgents)();
    const working = active.filter((a) => dependents.includes(a.repo_full_name));
    if (working.length > 0) {
        return {
            hasConflict: true,
            reason: `Dependent repo ${working[0].repo_full_name?.split('/')[1]} being modified by ${working[0].agent_label}`,
        };
    }
    return { hasConflict: false };
}
function getPendingConflict(conflictId) {
    return pendingConflicts.get(conflictId) || null;
}
function resolvePendingConflict(conflictId) {
    pendingConflicts.delete(conflictId);
}
module.exports = {
    checkAndLockFiles,
    releaseAllLocks,
    checkDependencyConflicts,
    getDependentRepos,
    getPendingConflict,
    resolvePendingConflict,
};
//# sourceMappingURL=conflictDetector.js.map