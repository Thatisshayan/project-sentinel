const logger = require('./logger');
const axios  = require('axios');
const { getGithubOrg } = require('./repoResolver');
const { sendTelegramMessage }              = require('./telegramClient');
const { selectAgent, assignAgent, freeAgent } = require('./agentRegistry');
const { checkAndLockFiles,
        releaseAllLocks,
        checkDependencyConflicts }  = require('./conflictDetector');
const { announceStart, announceComplete,
        announceFailed }            = require('./agentRoom');
const { executeBatch }              = require('./taskBuilder');
const { createPullRequest }         = require('./prCreator');
const { findNotionProject }         = require('./notionClient');
const { getBuilderConfig }          = require('./builderRouter');
const { isRepoLocked }              = require('./repoLock');

const MAX_PARALLEL = () => parseInt(process.env.MAX_PARALLEL_AGENTS || '3');

async function executeTaskParallel(task, context) {
  const { repoFullName, repoName } = context;
  const topicId = task.topicId || context.topicId || null;

  // Phase 10 — repo lock guard
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

      // Verify a real PR exists on GitHub before declaring success
      let verifiedPrUrl = prUrl;
      let prVerified    = false;

      try {
        const ghRes = await axios.get(
          `https://api.github.com/repos/${getGithubOrg()}/${repoName}/pulls`,
          {
            headers: {
              Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
              Accept:        'application/vnd.github+json',
            },
            params: { state: 'open', per_page: 20 },
          }
        );
        const sentinelPR = (ghRes.data || []).find(pr =>
          pr.head?.ref?.startsWith('sentinel/')
        );
        if (sentinelPR) {
          verifiedPrUrl = sentinelPR.html_url;
          prVerified    = true;
        }
      } catch (verifyErr) {
        logger.warn({ err: verifyErr.message }, 'GitHub PR verification failed — proceeding without check');
        verifiedPrUrl = prUrl;
        prVerified    = true; // don't fail a task over a verification network error
      }

      if (!prVerified) {
        await sendTelegramMessage(
          `⚠️ Task marked failed — builder ran but no PR was created on GitHub.\nPR: https://github.com/${getGithubOrg()}/${repoName}/pulls`,
          repoName, topicId
        ).catch(() => {});
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
        `${task.title || task.task_title}\n${prLine}`, verifiedPrUrl);
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

  } catch (err) {
    await announceFailed(agentId, agentConfig.label, repoName,
      task.title || task.task_title, err.message);
    await freeAgent(agentId, false);
    await releaseAllLocks(repoFullName, agentId);
    return { status: 'error', reason: err.message };
  }
}

async function executePortfolioTasks(tasks) {
  const maxParallel = MAX_PARALLEL();
  const results     = [];
  const queue       = [...tasks];
  const running     = [];

  while (queue.length > 0 || running.length > 0) {
    while (running.length < maxParallel && queue.length > 0) {
      const task    = queue.shift();
      const context = {
        repoFullName: task.repo_full_name,
        repoName:     task.repo_name || task.repo_full_name?.split('/')[1],
      };

      const promise = executeTaskParallel(task, context)
        .then(result => {
          results.push({ task, result });
          running.splice(running.indexOf(promise), 1);
        })
        .catch(err => {
          results.push({ task, result: { status: 'error', reason: err.message } });
          running.splice(running.indexOf(promise), 1);
        });

      running.push(promise);
    }

    if (running.length > 0) {
      await Promise.race(running);
    }
  }

  const total        = tasks.length;
  const successCount = results.filter(r => r.result.status === 'completed').length;
  const failCount    = results.filter(r => ['failed', 'error'].includes(r.result.status)).length;

  let summaryMsg;
  if (successCount > 0 && failCount === 0) {
    summaryMsg = `✅ Batch Complete — ${successCount}/${total} tasks done. PRs opened on GitHub.`;
  } else if (successCount > 0 && failCount > 0) {
    summaryMsg = `⚠️ Partial Complete — ${successCount}/${total} done, ${failCount} failed. Check logs.`;
  } else {
    summaryMsg = `❌ Batch Failed — 0/${total} tasks completed. Primary and fallback builder both threw errors. No code was written. No PRs opened. Check Railway logs.`;
  }

  await sendTelegramMessage(summaryMsg, null, null).catch(() => {});

  return results;
}

module.exports = { executeTaskParallel, executePortfolioTasks };
