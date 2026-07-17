import logger from './logger';
import { acquireFileLocks, releaseFileLocks, releaseExpiredLocks } from './agentDb';
import { announceConflict, sendConflictKeyboard } from './agentRoom';
import { repoFullName as resolveRepoFullName } from './repoResolver';

const DEPENDENT_REPOS: string[][] = [
  [resolveRepoFullName('AlphonsoEcosystem'), resolveRepoFullName('session-guard')],
];

const pendingConflicts = new Map<string, any>();

async function checkAndLockFiles(repoFullName: string, filePaths: string[], agentId: string, agentLabel: string, taskId: string | number): Promise<{ canProceed: boolean; conflicts: any[]; acquired: any[] }> {
  await releaseExpiredLocks().catch(() => {});

  if (!filePaths || filePaths.length === 0) {
    return { canProceed: true, conflicts: [], acquired: [] };
  }

  const { acquired, conflicts } = await acquireFileLocks(
    repoFullName, filePaths, agentId, Number(taskId)
  );

  if (conflicts.length > 0) {
    const conflictId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    pendingConflicts.set(conflictId, {
      repoFullName, agentId, agentLabel, filePaths, taskId, conflicts,
      createdAt: Date.now(),
    });
    setTimeout(() => pendingConflicts.delete(conflictId), 30 * 60 * 1000);

    const repoName = repoFullName.split('/')[1] || '';
    await sendConflictKeyboard(agentId, agentLabel, repoName, conflicts, conflictId);
    await announceConflict(agentId, agentLabel, repoName, conflicts);
  }

  const canProceed = acquired.length > 0 || filePaths.length === 0;

  return { canProceed, conflicts, acquired };
}

async function releaseAllLocks(repoFullName: string, agentId: string): Promise<any[]> {
  const released = await releaseFileLocks(repoFullName, agentId);
  logger.info({ repoFullName, agentId, count: released.length }, 'File locks released');
  return released;
}

function getDependentRepos(repoFullName: string): string[] {
  for (const pair of DEPENDENT_REPOS) {
    if (pair.includes(repoFullName)) {
      return pair.filter((r: string) => r !== repoFullName);
    }
  }
  return [];
}

async function checkDependencyConflicts(repoFullName: string): Promise<{ hasConflict: boolean; reason?: string }> {
  const { getActiveAgents } = require('./agentDb') as { getActiveAgents: () => Promise<any[]> };
  const dependents          = getDependentRepos(repoFullName);
  if (dependents.length === 0) return { hasConflict: false };

  const active  = await getActiveAgents();
  const working = active.filter((a: any) => dependents.includes(a.repo_full_name));

  if (working.length > 0) {
    return {
      hasConflict: true,
      reason: `Dependent repo ${working[0].repo_full_name?.split('/')[1]} being modified by ${working[0].agent_label}`,
    };
  }

  return { hasConflict: false };
}

function getPendingConflict(conflictId: string): any {
  return pendingConflicts.get(conflictId) || null;
}

function resolvePendingConflict(conflictId: string): void {
  pendingConflicts.delete(conflictId);
}

export = {
  checkAndLockFiles,
  releaseAllLocks,
  checkDependencyConflicts,
  getDependentRepos,
  getPendingConflict,
  resolvePendingConflict,
};
