const logger = require('./logger');
const { acquireFileLocks, releaseFileLocks,
        releaseExpiredLocks }  = require('./agentDb');
const { announceConflict }     = require('./agentRoom');

const DEPENDENT_REPOS = [
  ['Thatisshayan/AlphonsoEcosystem', 'Thatisshayan/session-guard'],
];

async function checkAndLockFiles(repoFullName, filePaths, agentId, agentLabel, taskId) {
  await releaseExpiredLocks().catch(() => {});

  if (!filePaths || filePaths.length === 0) {
    return { canProceed: true, conflicts: [], acquired: [] };
  }

  const { acquired, conflicts } = await acquireFileLocks(
    repoFullName, filePaths, agentId, taskId
  );

  if (conflicts.length > 0) {
    await announceConflict(agentId, agentLabel, repoFullName.split('/')[1], conflicts);
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

module.exports = {
  checkAndLockFiles,
  releaseAllLocks,
  checkDependencyConflicts,
  getDependentRepos,
};
