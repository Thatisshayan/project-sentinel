const logger = require('./logger');
const { acquireFileLocks, releaseFileLocks,
        releaseExpiredLocks }  = require('./agentDb');
const { announceConflict,
        sendConflictKeyboard } = require('./agentRoom');
const { repoFullName }         = require('./repoResolver');

const DEPENDENT_REPOS = [
  [repoFullName('AlphonsoEcosystem'), repoFullName('session-guard')],
];

// In-memory pending conflicts — resolved via Telegram inline keyboard
const pendingConflicts = new Map();

async function checkAndLockFiles(repoFullName, filePaths, agentId, agentLabel, taskId) {
  await releaseExpiredLocks().catch(() => {});

  if (!filePaths || filePaths.length === 0) {
    return { canProceed: true, conflicts: [], acquired: [] };
  }

  const { acquired, conflicts } = await acquireFileLocks(
    repoFullName, filePaths, agentId, taskId
  );

  if (conflicts.length > 0) {
    const conflictId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    pendingConflicts.set(conflictId, {
      repoFullName, agentId, agentLabel, filePaths, taskId, conflicts,
      createdAt: Date.now(),
    });
    // Auto-expire after 30 min
    setTimeout(() => pendingConflicts.delete(conflictId), 30 * 60 * 1000);

    const repoName = repoFullName.split('/')[1];
    // Send keyboard first (Improvement 4), then text fallback
    await sendConflictKeyboard(agentId, agentLabel, repoName, conflicts, conflictId);
    await announceConflict(agentId, agentLabel, repoName, conflicts);
  }

  const canProceed = acquired.length > 0 || filePaths.length === 0;

  return { canProceed, conflicts, acquired };
}

async function releaseAllLocks(repoFullName, agentId) {
  const released = await releaseFileLocks(repoFullName, agentId);
  logger.info({ repoFullName, agentId, count: released.length }, 'File locks released');
  return released;
}

function getDependentRepos(repoFullName) {
  for (const pair of DEPENDENT_REPOS) {
    if (pair.includes(repoFullName)) {
      return pair.filter(r => r !== repoFullName);
    }
  }
  return [];
}

async function checkDependencyConflicts(repoFullName) {
  const { getActiveAgents } = require('./agentDb');
  const dependents          = getDependentRepos(repoFullName);
  if (dependents.length === 0) return { hasConflict: false };

  const active  = await getActiveAgents();
  const working = active.filter(a => dependents.includes(a.repo_full_name));

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
