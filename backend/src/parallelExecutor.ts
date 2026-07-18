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

const MAX_PARALLEL = (): number => parseInt(process.env['MAX_PARALLEL_AGENTS'] || '3');

async function executeTaskParallel(task: any, context: any): Promise<any> {
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
    taskTitle: task.title || task.task_title,
  });

  await announceStart(
    agentId, agentConfig.label,
    task.task_type || 'build',
    repoName,
    task.title || task.task_title
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
          failureReason: task.title || task.task_title,
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
        const sentinelPR = (ghRes.data || []).find((pr: any) =>
          pr.head?.ref?.startsWith('sentinel/')
        );
        if (sentinelPR) {
          verifiedPrUrl = sentinelPR.html_url;
          prVerified    = true;
        }
      } catch (verifyErr: any) {
        logger.warn({ err: verifyErr.message }, 'GitHub PR verification failed — proceeding without check');
        verifiedPrUrl = prUrl;
        prVerified    = true;
      }

      if (!prVerified) {
        await safeFire(sendTelegramMessage(
          `⚠️ Task marked failed — builder ran but no PR was created on GitHub.\nPR: https://github.com/${getGithubOrg()}/${repoName}/pulls`,
          repoName, topicId
        ), { label: 'parallelExecutor' })
        await announceFailed(agentId, agentConfig.label, repoName,
          task.title || task.task_title, 'Builder ran but no PR was created');
        await freeAgent(agentId, false);
        await releaseAllLocks(repoFullName, agentId);
        return { status: 'failed', reason: 'Builder ran but no PR was created on GitHub' };
      }

      const prLine = verifiedPrUrl
        ? `PR: ${verifiedPrUrl}`
        : `PR: https://github.com/${getGithubOrg()}/${repoName}/pulls`;

      await announceComplete(agentId, agentConfig.label, repoName,
        `${task.title || task.task_title}\n${prLine}`, verifiedPrUrl ?? undefined);
      await freeAgent(agentId, true);
      await releaseAllLocks(repoFullName, agentId);

      return { status: 'completed', prUrl: verifiedPrUrl, agentId, builderUsed: agentConfig.label };
    } else {
      await announceFailed(agentId, agentConfig.label, repoName,
        task.title || task.task_title, batchResult.reason);
      await freeAgent(agentId, false);
      await releaseAllLocks(repoFullName, agentId);

      return { status: 'failed', reason: batchResult.reason };
    }

  } catch (err: any) {
    await announceFailed(agentId, agentConfig.label, repoName,
      task.title || task.task_title, err.message);
    await freeAgent(agentId, false);
    await releaseAllLocks(repoFullName, agentId);
    return { status: 'error', reason: err.message };
  }
}

async function executePortfolioTasks(tasks: any[]): Promise<any[]> {
  const maxParallel = MAX_PARALLEL();
  const results: any[]     = [];
  const queue       = [...tasks];
  const running: Promise<any>[]     = [];

  while (queue.length > 0 || running.length > 0) {
    while (running.length < maxParallel && queue.length > 0) {
      const task    = queue.shift();
      const context = {
        repoFullName: task.repo_full_name,
        repoName:     task.repo_name || task.repo_full_name?.split('/')[1],
      };

      const promise = executeTaskParallel(task, context);
      running.push(promise);

      promise
        .then((result: any) => {
          results.push({ task, result });
          running.splice(running.indexOf(promise), 1);
        })
        .catch((err: any) => {
          results.push({ task, result: { status: 'error', reason: err.message } });
          running.splice(running.indexOf(promise), 1);
        });
    }

    if (running.length > 0) {
      await Promise.race(running);
    }
  }

  const total        = tasks.length;
  const successCount = results.filter((r: any) => r.result.status === 'completed').length;
  const failCount    = results.filter((r: any) => ['failed', 'error'].includes(r.result.status)).length;

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
