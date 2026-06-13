const { Worker, Queue }       = require('bullmq');
const { getRedisConnection }  = require('./queueClient');
const { releaseExpiredLocks }                          = require('./agentDb');
const { updatePinnedStatusBoard, sendMorningBriefing } = require('./agentRoom');
const { runSelfAudit }  = require('./selfAuditor');
const { checkAndHeal }  = require('./selfHealer');
const { checkAllProviders }   = require('./buildPoller');
const { orchestrateDebug }    = require('./debugOrchestrator');
const { sendTelegramMessage } = require('./telegramClient');
const { findNotionProject, updateNotionProject } = require('./notionClient');
const { enqueueBuildCheck }   = require('./queueClient');
const logger                  = require('./logger');
const {
  triggerAudit,
  handleBuildPassedAfterSentinelMerge,
} = require('./auditOrchestrator');
const { sendDailyReport }        = require('./dailyReport');
const { detectPatterns }         = require('./patternDetector');
const { refreshAllMetrics }      = require('./portfolioAnalytics');
const { updateDashboard }        = require('./notionDashboard');
const { generateSprintProposal } = require('./sprintPlanner');
const { recordWeeklyVelocity }   = require('./velocityTracker');

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
          null,
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
        null,
        topicId
      ).catch(() => {});

      // Phase 3 — route based on whether this is a Sentinel PR or human commit
      const isSentinelBranch = (data.branchName || '').startsWith('sentinel/');

      if (isSentinelBranch) {
        // Build passed after Sentinel PR was merged — mark tasks done, start next batch
        handleBuildPassedAfterSentinelMerge(
          repoFullName,
          data.repoName,
          data.branchName,
          data.topicId
        ).catch(err =>
          logger.error({ err: err.message }, 'handleBuildPassedAfterSentinelMerge failed')
        );
      } else if (process.env.AUDIT_AGENT_ENABLED !== 'false') {
        // Human commit — trigger fresh audit (subject to 4 rules in auditOrchestrator)
        triggerAudit({
          repoFullName,
          repoName:      data.repoName,
          projectName:   data.projectName,
          commitSha,
          commitMessage: data.commitMessage,
          branchName:    data.branchName,
          authorName:    data.authorName,
          authorEmail:   data.authorEmail,
          topicId:       data.topicId,
        }).catch(err =>
          logger.error({ err: err.message }, 'Audit trigger failed — non-blocking')
        );
      }

      // Phase 4 — update dashboard on every build result
      updateDashboard().catch(() => {});
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
        null,
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

      // Phase 4 — update dashboard on build failure too
      updateDashboard().catch(() => {});
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

// ── Daily report worker (9am Toronto) ────────────────────────────────────────

function startDailyReportWorker() {
  const conn = getRedisConnection();
  if (!conn) {
    logger.warn('REDIS_URL not configured — daily report worker not started');
    return null;
  }

  const queue = new Queue('daily-report', { connection: conn });

  // Schedule the 9am Toronto cron — idempotent: same jobId won't duplicate
  queue.add('report', {}, {
    repeat:  { pattern: '0 9 * * *', tz: 'America/Toronto' },
    jobId:   'daily-report-cron',
  }).catch(err => logger.warn({ err: err.message }, 'Could not schedule daily report cron'));

  // 8am Toronto — agent room morning briefing (Improvement 5)
  queue.add('morning-briefing', {}, {
    repeat: { pattern: '0 8 * * *', tz: 'America/Toronto' },
    jobId:  'morning-briefing-cron',
  }).catch(err => logger.warn({ err: err.message }, 'Could not schedule morning briefing cron'));

  const worker = new Worker('daily-report', async (job) => {
    if (job.name === 'morning-briefing') {
      await sendMorningBriefing();
      return;
    }
    await refreshAllMetrics();
    await sendDailyReport();
    await detectPatterns();
    await updateDashboard();
  }, { connection: conn });

  worker.on('failed', (job, err) => {
    logger.error({ err: err.message }, 'Daily report worker failed');
  });

  logger.info('Daily report worker started — fires at 9am Toronto');
  return worker;
}

// ── Sprint worker (Sunday 8pm proposal + Wednesday 9am mid-week update) ───────

function startSprintWorker() {
  const conn = getRedisConnection();
  if (!conn) {
    logger.warn('REDIS_URL not configured — sprint worker not started');
    return null;
  }

  const queue = new Queue('sprint', { connection: conn });

  // Sunday 8pm Toronto — generate weekly sprint proposal
  queue.add('propose', {}, {
    repeat: { pattern: '0 20 * * 0', tz: 'America/Toronto' },
    jobId:  'sprint-proposal-cron',
  }).catch(err => logger.warn({ err: err.message }, 'Could not schedule sprint proposal cron'));

  // Wednesday 9am Toronto — mid-week progress update
  queue.add('midweek', {}, {
    repeat: { pattern: '0 9 * * 3', tz: 'America/Toronto' },
    jobId:  'sprint-midweek-cron',
  }).catch(err => logger.warn({ err: err.message }, 'Could not schedule sprint midweek cron'));

  // Sunday 9pm Toronto — Sentinel self-audit (after sprint proposal at 8pm)
  queue.add('self-audit', {}, {
    repeat: { pattern: '0 21 * * 0', tz: 'America/Toronto' },
    jobId:  'self-audit-cron',
  }).catch(err => logger.warn({ err: err.message }, 'Could not schedule self-audit cron'));

  const worker = new Worker('sprint', async (job) => {
    if (job.name === 'propose') {
      await recordWeeklyVelocity();
      await generateSprintProposal();
    }
    if (job.name === 'midweek') {
      const { getSprintStatus } = require('./sprintOrchestrator');
      await getSprintStatus(null);
    }
    if (job.name === 'self-audit') {
      await runSelfAudit();
      await checkAndHeal();
    }
  }, { connection: conn });

  worker.on('failed', (job, err) => {
    logger.error({ err: err.message, job: job?.name }, 'Sprint worker job failed');
  });

  logger.info('Sprint worker started — proposes Sunday 8pm, mid-week update Wednesday 9am');
  return worker;
}

// ── Agent cleanup worker (expired file locks every 1h) ────────────────────────

function startAgentCleanupWorker() {
  // Release expired file locks every hour
  setInterval(() => {
    releaseExpiredLocks().catch(() => {});
  }, 60 * 60 * 1000);

  // Improvement 1 — update pinned status board every 30 minutes
  setInterval(() => {
    updatePinnedStatusBoard().catch(() => {});
  }, 30 * 60 * 1000);

  // Send initial status board on startup (non-blocking)
  updatePinnedStatusBoard().catch(() => {});

  logger.info('Agent cleanup worker started (locks every 1h, status board every 30m)');
}

module.exports = { startBuildPollWorker, startDailyReportWorker, startSprintWorker, startAgentCleanupWorker };