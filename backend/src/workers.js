const { Worker, Queue }       = require('bullmq');
const { getRedisConnection }  = require('./queueClient');
const { releaseExpiredLocks }                          = require('./agentDb');
const { updatePinnedStatusBoard, sendMorningBriefing } = require('./agentRoom');
const { runSelfAudit }          = require('./selfAuditor');
const { checkAndHeal }          = require('./selfHealer');
const { pullAllMetrics }        = require('./businessMetrics');
let fetchAllMetrics;
try { ({ fetchAllMetrics } = require('./metricsFetcher')); } catch {}
let runSelfScaler;
try { ({ runSelfScaler } = require('./selfScaler')); } catch {}
const { scoreAllQueuedTasks }   = require('./roiScorer');
const { generateWeeklyReport }          = require('./weeklyBusinessReport');
const { runSecurityScan }               = require('./securityScanner');
const { generateMonthlySecurityReport } = require('./monthlySecurityReport');
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
const { refreshAllMetrics, refreshRepoMetrics } = require('./portfolioAnalytics');
const { syncAllRepoMetrics }     = require('./githubMetricsSyncer');
const { updateDashboard }        = require('./notionDashboard');
const { generateSprintProposal } = require('./sprintPlanner');
const { recordWeeklyVelocity }   = require('./velocityTracker');

let runPriorityEngine, generateCEOReport, runAgentStandup, postAgentLeaderboard;
try { ({ runPriorityEngine }    = require('./priorityEngine'));    } catch (e) { logger.warn({ err: e.message }, 'priorityEngine failed to load'); }
try { ({ generateCEOReport }    = require('./ceoReport'));         } catch (e) { logger.warn({ err: e.message }, 'ceoReport failed to load'); }
try { ({ runAgentStandup }      = require('./agentStandup'));      } catch (e) { logger.warn({ err: e.message }, 'agentStandup failed to load'); }
try { ({ postAgentLeaderboard } = require('./agentLeaderboard')); } catch (e) { logger.warn({ err: e.message }, 'agentLeaderboard failed to load'); }

let runStrategicBrain, recordBrainOutcome;
try { ({ runStrategicBrain, recordBrainOutcome } = require('./sentinelBrain')); } catch (e) { logger.warn({ err: e.message }, 'sentinelBrain failed to load'); }

const SENTINEL_TZ         = process.env.SENTINEL_TIMEZONE || 'America/Toronto';
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
          // Don't pass commit metadata — it was already written by the webhook
          // handler and must not be overwritten with empty values here.
          deploymentStatus:    result.overall,
          buildProvider:       result.buildProvider,
          buildUrl:            result.buildUrl,
          currentProjectState: result.overall === 'success' ? 'Resolved' : 'Broken',
          lastBuildError:      result.overall === 'failed'
            ? (result.failureReason || '').substring(0, 500)
            : undefined,
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

      // Phase 9 — security scan on every passing build (non-blocking)
      runSecurityScan({
        repoFullName,
        repoName:   data.repoName,
        commitSha,
        branchName: data.branchName,
        topicId:    data.topicId,
      }).catch(err => logger.error({ err: err.message }, 'Security scan failed'));

      refreshRepoMetrics(repoFullName, repoName)
        .catch(err => logger.warn({ err: err.message }, 'Post-build metrics refresh failed'));

      // Phase 4 — update dashboard on every build result
      updateDashboard().catch(() => {});
      return;
    }

    if (result.overall === 'failed') {
      logger.info({ repoFullName }, 'Build failed — notifying and triggering debug');

      const isSentinelBranchFailed = (data.branchName || '').startsWith('sentinel/');

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
          isSentinelBranchFailed
            ? `This was a Sentinel PR — tasks have been re-queued for retry.`
            : `Assessing whether automatic repair is safe...`,
        ].filter(Boolean).join('\n'),
        null,
        topicId
      ).catch(() => {});

      if (isSentinelBranchFailed) {
        // A Sentinel-created PR was merged but the post-merge build failed.
        // Re-queue tasks that were marked done in the last hour so they can be retried.
        const { query: dbq } = require('./dbClient');
        const requeued = await dbq(`
          UPDATE audit_tasks
          SET status = 'queued', safe_to_auto_execute = false,
              branch_name = NULL, commit_sha = NULL,
              pr_url = NULL, pr_number = NULL, updated_at = NOW()
          WHERE repo_full_name = $1
            AND status = 'done'
            AND updated_at > NOW() - INTERVAL '1 hour'
          RETURNING id
        `, [repoFullName]).catch(() => null);
        const count = requeued?.rows?.length || 0;
        if (count > 0) {
          logger.info({ count, repoFullName }, 'Tasks re-queued after post-merge build failure');
          await sendTelegramMessage(
            `🔁 ${count} task(s) re-queued for ${repoName} — use /sentinel tasks ${repoName} to review, then /sentinel force-execute ${repoName} to retry.`,
            null, topicId
          ).catch(() => {});
        }
      } else {
        // Human commit failure — trigger debug orchestrator
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

      refreshRepoMetrics(repoFullName, repoName)
        .catch(err => logger.warn({ err: err.message }, 'Post-build metrics refresh failed'));

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
    repeat:  { pattern: '0 9 * * *', tz: SENTINEL_TZ },
    jobId:   'daily-report-cron',
  }).catch(err => logger.warn({ err: err.message }, 'Could not schedule daily report cron'));

  // 8am Toronto — agent room morning briefing (Phase 6 Improvement 5)
  queue.add('morning-briefing', {}, {
    repeat: { pattern: '0 8 * * *', tz: SENTINEL_TZ },
    jobId:  'morning-briefing-cron',
  }).catch(err => logger.warn({ err: err.message }, 'Could not schedule morning briefing cron'));

  // 6am Toronto — pull business metrics before daily report (Phase 8)
  queue.add('pull-metrics', {}, {
    repeat: { pattern: '0 6 * * *', tz: SENTINEL_TZ },
    jobId:  'metrics-pull-cron',
  }).catch(err => logger.warn({ err: err.message }, 'Could not schedule metrics pull cron'));

  // Monday 8am Toronto — weekly business + technical report (Phase 8)
  queue.add('weekly-report', {}, {
    repeat: { pattern: '0 8 * * 1', tz: SENTINEL_TZ },
    jobId:  'weekly-report-cron',
  }).catch(err => logger.warn({ err: err.message }, 'Could not schedule weekly report cron'));

  // First day of month 8am Toronto — monthly security posture report (Phase 9)
  queue.add('monthly-security', {}, {
    repeat: { pattern: '0 8 1 * *', tz: SENTINEL_TZ },
    jobId:  'monthly-security-cron',
  }).catch(err => logger.warn({ err: err.message }, 'Could not schedule monthly security cron'));

  // Daily 6:30am Toronto — priority engine (after business metrics pull at 6am)
  queue.add('priority-engine', {}, {
    repeat: { pattern: '30 6 * * *', tz: SENTINEL_TZ },
    jobId:  'priority-engine-cron',
  }).catch(err => logger.warn({ err: err.message }, 'Could not schedule priority engine cron'));

  // Daily 9am Toronto — agent standup (fires in agent-room before daily report)
  queue.add('agent-standup', {}, {
    repeat: { pattern: '0 9 * * *', tz: SENTINEL_TZ },
    jobId:  'agent-standup-cron',
  }).catch(err => logger.warn({ err: err.message }, 'Could not schedule agent standup cron'));

  // Sunday 10pm Toronto — CEO report (after sprint executes)
  queue.add('ceo-report', {}, {
    repeat: { pattern: '0 22 * * 0', tz: SENTINEL_TZ },
    jobId:  'ceo-report-cron',
  }).catch(err => logger.warn({ err: err.message }, 'Could not schedule CEO report cron'));

  // Sunday 10:30pm Toronto — agent leaderboard (after CEO report)
  queue.add('agent-leaderboard', {}, {
    repeat: { pattern: '30 22 * * 0', tz: SENTINEL_TZ },
    jobId:  'agent-leaderboard-cron',
  }).catch(err => logger.warn({ err: err.message }, 'Could not schedule agent leaderboard cron'));

  // Sunday 11pm Toronto — weekly audit sweep: trigger audits on all repos
  queue.add('weekly-audit', {}, {
    repeat: { pattern: '0 23 * * 0', tz: SENTINEL_TZ },
    jobId:  'weekly-audit-cron',
  }).catch(err => logger.warn({ err: err.message }, 'Could not schedule weekly audit cron'));

  // Friday 5pm Toronto — stale task report: surface queued tasks older than 7 days
  queue.add('stale-tasks', {}, {
    repeat: { pattern: '0 17 * * 5', tz: SENTINEL_TZ },
    jobId:  'stale-tasks-cron',
  }).catch(err => logger.warn({ err: err.message }, 'Could not schedule stale tasks cron'));

  // Daily 5am Toronto — re-probe AI provider API keys (Item 1: catch keys that
  // go bad mid-day, not just at deploy/startup) and mark agents 'error' if so.
  queue.add('provider-health', {}, {
    repeat: { pattern: '0 5 * * *', tz: SENTINEL_TZ },
    jobId:  'provider-health-cron',
  }).catch(err => logger.warn({ err: err.message }, 'Could not schedule provider health cron'));

  // Every 3 hours — sync repo health metrics from GitHub API directly.
  // This is the fallback source when webhooks are not arriving; it prevents
  // all repos from showing the default 6.5 health score indefinitely.
  queue.add('github-metrics-sync', {}, {
    repeat: { every: 3 * 60 * 60 * 1000 },
    jobId:  'github-metrics-sync-repeat',
  }).catch(err => logger.warn({ err: err.message }, 'Could not schedule GitHub metrics sync'));

  // Daily 6:55am Toronto — record yesterday's brain outcome before today's decision
  queue.add('brain-outcome', {}, {
    repeat: { pattern: '55 6 * * *', tz: SENTINEL_TZ },
    jobId:  'brain-outcome-cron',
  }).catch(err => logger.warn({ err: err.message }, 'Could not schedule brain outcome cron'));

  // Daily 7am Toronto — strategic brain: gather intel, make decision, auto-execute
  queue.add('brain-strategy', {}, {
    repeat: { pattern: '0 7 * * *', tz: SENTINEL_TZ },
    jobId:  'brain-strategy-cron',
  }).catch(err => logger.warn({ err: err.message }, 'Could not schedule brain strategy cron'));

  const worker = new Worker('daily-report', async (job) => {
    if (job.name === 'morning-briefing') {
      await sendMorningBriefing();
      return;
    }
    if (job.name === 'pull-metrics') {
      await pullAllMetrics();
      if (fetchAllMetrics) await fetchAllMetrics().catch(e => logger.warn({ err: e.message }, 'metricsFetcher failed'));
      await scoreAllQueuedTasks();
      if (runSelfScaler) await runSelfScaler().catch(() => {});
      return;
    }
    if (job.name === 'weekly-report') {
      await generateWeeklyReport();
      return;
    }
    if (job.name === 'monthly-security') {
      await generateMonthlySecurityReport();
      return;
    }
    if (job.name === 'priority-engine') {
      if (runPriorityEngine) await runPriorityEngine();
      else logger.warn('priority-engine job fired but priorityEngine module did not load');
      return;
    }
    if (job.name === 'agent-standup') {
      if (runAgentStandup) await runAgentStandup();
      else logger.warn('agent-standup job fired but agentStandup module did not load');
      return;
    }
    if (job.name === 'ceo-report') {
      if (generateCEOReport) await generateCEOReport(null);
      else logger.warn('ceo-report job fired but ceoReport module did not load');
      return;
    }
    if (job.name === 'agent-leaderboard') {
      if (postAgentLeaderboard) await postAgentLeaderboard();
      else logger.warn('agent-leaderboard job fired but agentLeaderboard module did not load');
      return;
    }
    if (job.name === 'weekly-audit') {
      const { REPO_LIST } = require('./portfolioAnalytics');
      let audited = 0;
      for (const repo of REPO_LIST) {
        try {
          await triggerAudit({
            repoFullName:  repo.repoFullName,
            repoName:      repo.repoName,
            projectName:   repo.repoName,
            commitSha:     `weekly-audit-${Date.now()}`,
            commitMessage: '[weekly-audit]',
            branchName:    'main',
            authorName:    'Sentinel',
            authorEmail:   '',
            topicId:       null,
          });
          audited++;
          await new Promise(r => setTimeout(r, 3000)); // pace audits, 3s apart
        } catch (e) {
          logger.warn({ err: e.message, repo: repo.repoName }, 'Weekly audit failed for repo');
        }
      }
      await sendTelegramMessage(
        `🔍 Weekly audit sweep — ${audited}/${REPO_LIST.length} repos queued for audit.`,
        null, null
      ).catch(() => {});
      return;
    }
    if (job.name === 'stale-tasks') {
      const { query: dbq } = require('./dbClient');
      const result = await dbq(`
        SELECT repo_full_name, COUNT(*) AS count
        FROM audit_tasks
        WHERE status = 'queued'
          AND created_at < NOW() - INTERVAL '7 days'
        GROUP BY repo_full_name
        ORDER BY count DESC
      `).catch(() => null);
      const rows = result?.rows || [];
      if (rows.length === 0) {
        logger.info('Stale task check — no stale tasks found');
        return;
      }
      const lines = rows.map(r =>
        `  · ${r.repo_full_name.split('/')[1]}: ${r.count} task(s)`
      ).join('\n');
      await sendTelegramMessage(
        `🕰️ Stale Task Report — tasks queued >7 days:\n\n${lines}\n\n` +
        `Run: /sentinel force-execute <repo> to execute, or /sentinel skip <repo> to clear.`,
        null, null
      ).catch(() => {});
      return;
    }
    if (job.name === 'provider-health') {
      const { probeAIProviders } = require('./providerHealthCheck');
      await probeAIProviders().catch(e => logger.warn({ err: e.message }, 'Daily provider health probe failed'));
      return;
    }
    if (job.name === 'github-metrics-sync') {
      await syncAllRepoMetrics().catch(e => logger.warn({ err: e.message }, 'GitHub metrics sync failed'));
      return;
    }
    if (job.name === 'brain-outcome') {
      if (recordBrainOutcome) await recordBrainOutcome();
      else logger.warn('brain-outcome job fired but sentinelBrain module did not load');
      return;
    }
    if (job.name === 'brain-strategy') {
      if (runStrategicBrain) await runStrategicBrain(null);
      else logger.warn('brain-strategy job fired but sentinelBrain module did not load');
      return;
    }
    await refreshAllMetrics();
    // Cost threshold alert — fires alongside daily report
    try {
      const { getDailyCost } = require('./portfolioDb');
      const dailyCost      = await getDailyCost();
      const alertThreshold = parseFloat(process.env.DAILY_COST_ALERT_USD || '5');
      if (dailyCost > alertThreshold) {
        await sendTelegramMessage(
          `💸 Cost Alert — $${dailyCost.toFixed(2)} spent today (limit: $${alertThreshold})\n` +
          `Use /sentinel costs for a full breakdown.`,
          null, null
        ).catch(() => {});
      }
    } catch (e) { logger.warn({ err: e.message }, 'Cost alert check failed'); }
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
    repeat: { pattern: '0 20 * * 0', tz: SENTINEL_TZ },
    jobId:  'sprint-proposal-cron',
  }).catch(err => logger.warn({ err: err.message }, 'Could not schedule sprint proposal cron'));

  // Wednesday 9am Toronto — mid-week progress update
  queue.add('midweek', {}, {
    repeat: { pattern: '0 9 * * 3', tz: SENTINEL_TZ },
    jobId:  'sprint-midweek-cron',
  }).catch(err => logger.warn({ err: err.message }, 'Could not schedule sprint midweek cron'));

  // Sunday 9pm Toronto — Sentinel self-audit (after sprint proposal at 8pm)
  queue.add('self-audit', {}, {
    repeat: { pattern: '0 21 * * 0', tz: SENTINEL_TZ },
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