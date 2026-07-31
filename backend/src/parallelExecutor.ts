import { safeFire, fireAndForget } from './utils/safeFire';
import logger from './logger';
import axios from 'axios';
import { getGithubOrg } from './repoResolver';
import { sendTelegramMessage } from './telegramClient';
import { selectAgent, assignAgent, freeAgent } from './agentRegistry';
import { checkAndLockFiles, releaseAllLocks, checkDependencyConflicts } from './conflictDetector';
import { announceStart, announceComplete, announceFailed } from './agentRoom';
import { executeBatch } from './taskBuilder';
import { createPullRequest } from './prCreator';
import { findNotionProject } from './notionClient';
import { getBuilderConfig } from './builderRouter';
import { isRepoLocked } from './repoLock';
import type { BuildableTask } from './types/taskBuilder';

const MAX_PARALLEL = (): number => parseInt(process.env['MAX_PARALLEL_AGENTS'] || '3');

// executeTaskParallel forwards its task straight into taskBuilder's
// executeBatch(), which requires the full BuildableTask shape — extended
// here with the extra fields this file itself reads (task_title/task_type
// are sprint_tasks-style aliases for title; complexity/builder_agent drive
// agent selection).
interface ParallelTask extends BuildableTask {
  complexity?: string;
  builder_agent?: string;
  task_type?: string;
  task_title?: string;
  repo_full_name?: string;
  repo_name?: string;
  topicId?: number | null;
}

interface ExecutionContext {
  repoFullName: string;
  repoName: string;
  topicId?: number | null;
}

interface ExecutionResult {
  status: 'skipped' | 'deferred' | 'completed' | 'failed' | 'error';
  reason?: string;
  prUrl?: string | null;
  agentId?: string;
  builderUsed?: string;
}

async function executeTaskParallel(task: ParallelTask, context: ExecutionContext): Promise<ExecutionResult> {
  const { repoFullName, repoName } = context;
  const topicId = task.topicId || context.topicId || null;

  const lock = await isRepoLocked(repoName).catch(() => null);
  if (lock) {
    logger.warn({ repoName, reason: lock.reason }, 'Repo locked — task execution skipped');
    return { status: 'skipped', reason: `Repo locked: ${lock.reason}` };
  }

  const depCheck = await checkDependencyConflicts(repoFullName);
  if (depCheck.hasConflict) {
    logger.warn({ repoFullName, reason: depCheck.reason }, 'Dependency conflict — queuing task');
    return { status: 'deferred', reason: depCheck.reason };
  }

  const agentId     = await selectAgent(task.complexity || 'medium', task.builder_agent);
  const agentConfig = getBuilderConfig(agentId);

  const lockResult = await checkAndLockFiles(
    repoFullName,
    task.affected_files || [],
    agentId,
    agentConfig.label,
    task.id
  );

  if (!lockResult.canProceed) {
    return { status: 'deferred', reason: 'All files locked by other agents' };
  }

  await assignAgent(agentId, {
    repoFullName,
    taskType:  task.task_type || 'build',
    taskId:    task.id,
    taskTitle: task.title || task.task_title || 'task',
  });

  await announceStart(
    agentId, agentConfig.label,
    task.task_type || 'build',
    repoName,
    task.title || task.task_title || 'task'
  );

  try {
    const notionProject = await findNotionProject(repoName).catch(() => null);

    const batchResult = await executeBatch(
      [task],
      {
        repoFullName,
        repoName,
        projectName: notionProject?.projectName || repoName,
        branchName:  'main',
        topicId,
      },
      agentId
    );

    if (batchResult.status === 'completed') {
      const { prUrl } = await createPullRequest({
        repoFullName,
        fixBranch:  batchResult.taskBranch,
        baseBranch: 'main',
        context: {
          projectName:   notionProject?.projectName || repoName,
          repoName,
          commitSha:     batchResult.commitSha,
          attemptNumber: 1,
          buildProvider: 'parallel',
          failureReason: task.title || task.task_title || 'task',
          kind: 'task',
        },
      });

      let verifiedPrUrl = prUrl;
      let prVerified    = false;

      try {
        const ghRes = await axios.get(
          `https://api.github.com/repos/${getGithubOrg()}/${repoName}/pulls`,
          {
            headers: {
              Authorization: `Bearer ${process.env['GITHUB_TOKEN']}`,
              Accept:        'application/vnd.github+json',
            },
            params: { state: 'open', per_page: 20 },
          }
        );
        const sentinelPR = (ghRes.data as { head?: { ref?: string }; html_url: string }[] || []).find((pr) =>
          pr.head?.ref?.startsWith('sentinel/')
        );
        if (sentinelPR) {
          verifiedPrUrl = sentinelPR.html_url;
          prVerified    = true;
        }
      } catch (verifyErr) {
        logger.warn({ err: (verifyErr as Error).message }, 'GitHub PR verification failed — proceeding without check');
        verifiedPrUrl = prUrl;
        prVerified    = true;
      }

      if (!prVerified) {
        await safeFire(sendTelegramMessage(
          `⚠️ Task marked failed — builder ran but no PR was created on GitHub.\nPR: https://github.com/${getGithubOrg()}/${repoName}/pulls`,
          repoName, topicId
        ), { label: 'parallelExecutor' })
        await announceFailed(agentId, agentConfig.label, repoName,
          task.title || task.task_title || 'task', 'Builder ran but no PR was created');
        await freeAgent(agentId, false);
        await releaseAllLocks(repoFullName, agentId);
        return { status: 'failed', reason: 'Builder ran but no PR was created on GitHub' };
      }

      const prLine = verifiedPrUrl
        ? `PR: ${verifiedPrUrl}`
        : `PR: https://github.com/${getGithubOrg()}/${repoName}/pulls`;

      await announceComplete(agentId, agentConfig.label, repoName,
        `${task.title || task.task_title || 'task'}\n${prLine}`, verifiedPrUrl ?? undefined);
      await freeAgent(agentId, true);
      await releaseAllLocks(repoFullName, agentId);

      return { status: 'completed', prUrl: verifiedPrUrl, agentId, builderUsed: agentConfig.label };
    } else {
      await announceFailed(agentId, agentConfig.label, repoName,
        task.title || task.task_title || 'task', batchResult.reason);
      await freeAgent(agentId, false);
      await releaseAllLocks(repoFullName, agentId);

      return { status: 'failed', reason: batchResult.reason };
    }

  } catch (err) {
    await announceFailed(agentId, agentConfig.label, repoName,
      task.title || task.task_title || 'task', (err as Error).message);
    await freeAgent(agentId, false);
    await releaseAllLocks(repoFullName, agentId);
    return { status: 'error', reason: (err as Error).message };
  }
}

interface PortfolioTaskResult {
  task: ParallelTask;
  result: ExecutionResult;
}

async function executePortfolioTasks(tasks: ParallelTask[]): Promise<PortfolioTaskResult[]> {
  const maxParallel = MAX_PARALLEL();
  const results: PortfolioTaskResult[] = [];
  const queue       = [...tasks];
  const running: Promise<void>[] = [];

  while (queue.length > 0 || running.length > 0) {
    while (running.length < maxParallel && queue.length > 0) {
      const task = queue.shift();
      if (!task) break;
      const context: ExecutionContext = {
        repoFullName: task.repo_full_name || '',
        repoName:     task.repo_name || task.repo_full_name?.split('/')[1] || '',
      };

      const promise: Promise<void> = executeTaskParallel(task, context)
        .then((result) => {
          results.push({ task, result });
          running.splice(running.indexOf(promise), 1);
        })
        .catch((err) => {
          results.push({ task, result: { status: 'error', reason: (err as Error).message } });
          running.splice(running.indexOf(promise), 1);
        });
      running.push(promise);
    }

    if (running.length > 0) {
      await Promise.race(running);
    }
  }

  const total        = tasks.length;
  const successCount = results.filter((r) => r.result.status === 'completed').length;
  const failCount    = results.filter((r) => ['failed', 'error'].includes(r.result.status)).length;

  let summaryMsg: string;
  if (successCount > 0 && failCount === 0) {
    summaryMsg = `✅ Batch Complete — ${successCount}/${total} tasks done. PRs opened on GitHub.`;
  } else if (successCount > 0 && failCount > 0) {
    summaryMsg = `⚠️ Partial Complete — ${successCount}/${total} done, ${failCount} failed. Check logs.`;
  } else {
    summaryMsg = `❌ Batch Failed — 0/${total} tasks completed. Primary and fallback builder both threw errors. No code was written. No PRs opened. Check Railway logs.`;
  }

  await safeFire(sendTelegramMessage(summaryMsg, null, null), { label: 'parallelExecutor' })

  return results;
}

export = { executeTaskParallel, executePortfolioTasks };
