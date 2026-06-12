const { Worker }              = require('bullmq');
const { getRedisConnection }  = require('./queueClient');
const { checkAllProviders }   = require('./buildPoller');
const { orchestrateDebug }    = require('./debugOrchestrator');
const { sendTelegramMessage } = require('./telegramClient');
const { findNotionProject, updateNotionProject } = require('./notionClient');
const { enqueueBuildCheck }   = require('./queueClient');
const logger                  = require('./logger');

const POLL_INTERVAL_MS    = 30  * 1000; // 30 seconds between polls
const MAX_POLL_ATTEMPTS   = 20;         // 20 × 30s = 10 minutes max

// ── Build poll worker ─────────────────────────────────────────────────────────

function startBuildPollWorker() {
  const conn = getRedisConnection();
  if (!conn) {
    logger.warn('REDIS_URL not configured — build poll worker not started');
    return null;
  }

  const worker = new Worker('build-poll', async (job) => {
    const data = job.data;
    const { repoFullName, commitSha, repoName, projectName,
            topicId, attemptNumber = 0 } = data;

    logger.info(
      { repoFullName, commitSha: commitSha?.slice(0, 7), pollAttempt: attemptNumber },
      'Build poll job running'
    );

    // Check build status
    const result = await checkAllProviders(repoFullName, commitSha);

    if (result.overall === 'pending') {
      // Still building — re-queue after interval if under max attempts
      if (attemptNumber >= MAX_POLL_ATTEMPTS) {
        logger.warn({ repoFullName }, 'Build poll timeout');
        await sendTelegramMessage(
          `Project Sentinel — Build Timeout ⏱️\n\nRepo: ${repoName}\nBuild still pending after 10 minutes.\nCheck manually: ${result.buildUrl || 'N/A'}`,
          topicId
        ).catch(() => {});
        return;
      }

      // Re-queue with incremented attempt count
      const { Queue } = require('bullmq');
      const queue = new Queue('build-poll', { connection: conn });
      await queue.add('check', { ...data, attemptNumber: attemptNumber + 1 }, {
        jobId: `${job.id}-${attemptNumber + 1}`,
        delay: POLL_INTERVAL_MS,
      });
      await queue.close();
      return;
    }

    if (result.overall === 'not_configured') {
      logger.info({ repoFullName }, 'No build providers configured — skipping');
      return;
    }

    // Build resolved — update Notion
    try {
      const project = await findNotionProject(repoName);
      if (project) {
        await updateNotionProject(project.pageId, {
          commitSha,
          commitMessage:       '',
          commitUrl:           '',
          branchName:          '',
          authorName:          '',
          commitTimestamp:     new Date().toISOString(),
          changedFilesText:    '',
          filesChangedCount:   0,
          riskLevel:           'Medium',
          deploymentStatus:    result.overall,
          buildProvider:       result.buildProvider,
          buildUrl:            result.buildUrl,
          currentProjectState: result.overall === 'success' ? 'Resolved' : 'Broken',
          lastBuildError:      result.overall === 'failed'
            ? (result.failureReason || '').substring(0, 500)
            : '',
        });
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'Could not update Notion after build poll');
    }

    if (result.overall === 'success') {
      logger.info({ repoFullName }, 'Build passed');

      await sendTelegramMessage(
        [
          `Project Sentinel — Build Passed ✅`,
          ``,
          `Project: ${projectName || repoName}`,
          `Repo: ${repoName}`,
          `Commit: ${commitSha.substring(0, 7)}`,
          `Provider: ${result.buildProvider}`,
          result.buildUrl ? `Build: ${result.buildUrl}` : '',
        ].filter(Boolean).join('\n'),
        topicId
      ).catch(() => {});
      return;
    }

    if (result.overall === 'failed') {
      logger.info({ repoFullName }, 'Build failed — notifying and triggering debug');

      await sendTelegramMessage(
        [
          `Project Sentinel — Build Failed ❌`,
          ``,
          `Project: ${projectName || repoName}`,
          `Repo: ${repoName}`,
          `Commit: ${commitSha.substring(0, 7)}`,
          `Provider: ${result.buildProvider}`,
          result.buildUrl ? `Build: ${result.buildUrl}` : '',
          `Reason: ${result.failureReason || 'See build logs'}`,
          ``,
          `Assessing whether automatic repair is safe...`,
        ].filter(Boolean).join('\n'),
        topicId
      ).catch(() => {});

      // Trigger debug orchestrator
      await orchestrateDebug({
        projectName,
        repoName,
        repoFullName,
        branchName:    data.branchName,
        commitSha,
        commitUrl:     data.commitUrl,
        commitMessage: data.commitMessage,
        authorName:    data.authorName,
        changedFiles:  data.changedFiles || [],
        buildProvider: result.buildProvider,
        buildUrl:      result.buildUrl,
        logsUrl:       result.logsUrl,
        failureReason: result.failureReason,
        failureLogs:   '',
        topicId,
      });
    }

  }, {
    connection:  conn,
    concurrency: 5,
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'Build poll job failed');
  });

  logger.info('Build poll worker started');
  return worker;
}

module.exports = { startBuildPollWorker };