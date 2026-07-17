import { Worker, Queue } from 'bullmq';
import { getRedisConnection } from './queueClient';
import { releaseExpiredLocks } from './agentDb';
import { updatePinnedStatusBoard, sendMorningBriefing } from './agentRoom';
import { runSelfAudit } from './selfAuditor';
import { checkAndHeal } from './selfHealer';
import { pullAllMetrics } from './businessMetrics';
import { scoreAllQueuedTasks } from './roiScorer';
import { generateWeeklyReport } from './weeklyBusinessReport';
import { runSecurityScan } from './securityScanner';
import { generateMonthlySecurityReport } from './monthlySecurityReport';
import { checkAllProviders } from './buildPoller';
import { orchestrateDebug } from './debugOrchestrator';
import { sendTelegramMessage } from './telegramClient';
import { findNotionProject, updateNotionProject } from './notionClient';
import { enqueueBuildCheck } from './queueClient';
import logger from './logger';
import { triggerAudit, handleBuildPassedAfterSentinelMerge } from './auditOrchestrator';
import { sendDailyReport } from './dailyReport';
import { detectPatterns } from './patternDetector';
import { refreshAllMetrics, refreshRepoMetrics } from './portfolioAnalytics';
import { syncAllRepoMetrics } from './githubMetricsSyncer';
import { updateDashboard } from './notionDashboard';
import { generateSprintProposal } from './sprintPlanner';
import { recordWeeklyVelocity } from './velocityTracker';
import dbClient from './dbClient';

const { query } = dbClient;

let fetchAllMetrics: (() => Promise<void>) | undefined;
try { ({ fetchAllMetrics } = require('./metricsFetcher')); } catch {}
let runSelfScaler: (() => Promise<void>) | undefined;
try { ({ runSelfScaler } = require('./selfScaler')); } catch {}

let runPriorityEngine: (() => Promise<void>) | undefined;
let generateCEOReport: ((arg: any) => Promise<void>) | undefined;
let runAgentStandup: (() => Promise<void>) | undefined;
let postAgentLeaderboard: (() => Promise<void>) | undefined;
try { ({ runPriorityEngine }    = require('./priorityEngine'));    } catch (e: any) { logger.warn({ err: e.message }, 'priorityEngine failed to load'); }
try { ({ generateCEOReport }    = require('./ceoReport'));         } catch (e: any) { logger.warn({ err: e.message }, 'ceoReport failed to load'); }
try { ({ runAgentStandup }      = require('./agentStandup'));      } catch (e: any) { logger.warn({ err: e.message }, 'agentStandup failed to load'); }
try { ({ postAgentLeaderboard } = require('./agentLeaderboard')); } catch (e: any) { logger.warn({ err: e.message }, 'agentLeaderboard failed to load'); }

let runStrategicBrain: ((arg: any) => Promise<void>) | undefined;
let recordBrainOutcome: (() => Promise<void>) | undefined;
try { ({ runStrategicBrain, recordBrainOutcome } = require('./sentinelBrain')); } catch (e: any) { logger.warn({ err: e.message }, 'sentinelBrain failed to load'); }

const SENTINEL_TZ         = process.env['SENTINEL_TIMEZONE'] || 'America/Toronto';
const POLL_INTERVAL_MS    = 30  * 1000;
const MAX_POLL_ATTEMPTS   = 20;

// ── Build poll worker ─────────────────────────────────────────────────────────

function startBuildPollWorker(): Worker | null {
  const conn = getRedisConnection();
  if (!conn) {
    logger.warn('REDIS_URL not configured — build poll worker not started');
    return null;
  }

  const worker = new Worker('build-poll', async (job: any) => {
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
      await enqueueBuildCheck({
        ...data,
        attemptNumber: attemptNumber + 1,
      }).catch((err: any) =>
        logger.error({ err: err.message }, 'Failed to re-queue build check')
      );
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
          deploymentStatus:    result.overall,
          buildProvider:       result.buildProvider,
          buildUrl:            result.buildUrl,
          currentProjectState: result.overall === 'success' ? 'Resolved' : 'Broken',
          lastBuildError:      result.overall === 'failed'
            ? (result.failureReason || '').substring(0, 500)
            : undefined,
        });
      }
    } catch (err: any) {
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
        await handleBuildPassedAfterSentinelMerge(
          repoFullName,
          data.repoName,
          data.branchName,
          data.topicId
        ).catch((err: any) =>
          logger.error({ err: err.message }, 'handleBuildPassedAfterSentinelMerge failed')
        );
      } else if (process.env['AUDIT_AGENT_ENABLED'] !== 'false') {
        // Human commit — trigger fresh audit (subject to 4 rules in auditOrchestrator)
        await triggerAudit({
          repoFullName,
          repoName:      data.repoName,
          projectName:   data.projectName,
          commitSha,
          commitMessage: data.commitMessage,
          branchName:    data.branchName,
          authorName:    data.authorName,
          authorEmail:   data.authorEmail,
          topicId:       data.topicId,
        }).catch((err: any) =>
          logger.error({ err: err.message }, 'Audit trigger failed')
        );
      }

      // Phase 9 — security scan on every passing build (non-blocking)
      runSecurityScan({
        repoFullName,
        repoName:   data.repoName,
        commitSha,
        branchName: data.branchName,
        topicId:    data.topicId,
      }).catch((err: any) => logger.error({ err: err.message }, 'Security scan failed'));

      refreshRepoMetrics(repoFullName, repoName)
        .catch((err: any) => logger.warn({ err: err.message }, 'Post-build metrics refresh failed'));

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
        const requeued = await query(`
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
        .catch((err: any) => logger.warn({ err: err.message }, 'Post-build metrics refresh failed'));

      // Phase 4 — update dashboard on build failure too
      updateDashboard().catch(() => {});
    }

  }, {
    connection:  conn,
    concurrency: 5,
  });

  worker.on('failed', (job: any, err: Error) => {
    logger.error({ jobId: job?.id, err: err.message }, 'Build poll job failed');
  });

  logger.info('Build poll worker started');
  return worker;
}

// ── Daily report worker (9am Toronto) ────────────────────────────────────────

function startDailyReportWorker(): Worker | null {
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
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule daily report cron'));

  // 8am Toronto — agent room morning briefing (Phase 6 Improvement 5)
  queue.add('morning-briefing', {}, {
    repeat: { pattern: '0 8 * * *', tz: SENTINEL_TZ },
    jobId:  'morning-briefing-cron',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule morning briefing cron'));

  // 6am Toronto — pull business metrics before daily report (Phase 8)
  queue.add('pull-metrics', {}, {
    repeat: { pattern: '0 6 * * *', tz: SENTINEL_TZ },
    jobId:  'metrics-pull-cron',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule metrics pull cron'));

  // Monday 8am Toronto — weekly business + technical report (Phase 8)
  queue.add('weekly-report', {}, {
    repeat: { pattern: '0 8 * * 1', tz: SENTINEL_TZ },
    jobId:  'weekly-report-cron',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule weekly report cron'));

  // First day of month 8am Toronto — monthly security posture report (Phase 9)
  queue.add('monthly-security', {}, {
    repeat: { pattern: '0 8 1 * *', tz: SENTINEL_TZ },
    jobId:  'monthly-security-cron',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule monthly security cron'));

  // Daily 6:30am Toronto — priority engine (after business metrics pull at 6am)
  queue.add('priority-engine', {}, {
    repeat: { pattern: '30 6 * * *', tz: SENTINEL_TZ },
    jobId:  'priority-engine-cron',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule priority engine cron'));

  // Daily 9am Toronto — agent standup (fires in agent-room before daily report)
  queue.add('agent-standup', {}, {
    repeat: { pattern: '0 9 * * *', tz: SENTINEL_TZ },
    jobId:  'agent-standup-cron',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule agent standup cron'));

  // Sunday 10pm Toronto — CEO report (after sprint executes)
  queue.add('ceo-report', {}, {
    repeat: { pattern: '0 22 * * 0', tz: SENTINEL_TZ },
    jobId:  'ceo-report-cron',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule CEO report cron'));

  // Sunday 10:30pm Toronto — agent leaderboard (after CEO report)
  queue.add('agent-leaderboard', {}, {
    repeat: { pattern: '30 22 * * 0', tz: SENTINEL_TZ },
    jobId:  'agent-leaderboard-cron',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule agent leaderboard cron'));

  // Sunday 11pm Toronto — weekly audit sweep: trigger audits on all repos
  queue.add('weekly-audit', {}, {
    repeat: { pattern: '0 23 * * 0', tz: SENTINEL_TZ },
    jobId:  'weekly-audit-cron',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule weekly audit cron'));

  // Friday 5pm Toronto — stale task report: surface queued tasks older than 7 days
  queue.add('stale-tasks', {}, {
    repeat: { pattern: '0 17 * * 5', tz: SENTINEL_TZ },
    jobId:  'stale-tasks-cron',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule stale tasks cron'));

  // Daily 5am Toronto — re-probe AI provider API keys (Item 1: catch keys that
  // go bad mid-day, not just at deploy/startup) and mark agents 'error' if so.
  queue.add('provider-health', {}, {
    repeat: { pattern: '0 5 * * *', tz: SENTINEL_TZ },
    jobId:  'provider-health-cron',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule provider health cron'));

  // Every 3 hours — sync repo health metrics from GitHub API directly.
  // This is the fallback source when webhooks are not arriving; it prevents
  // all repos from showing the default 6.5 health score indefinitely.
  queue.add('github-metrics-sync', {}, {
    repeat: { every: 3 * 60 * 60 * 1000 },
    jobId:  'github-metrics-sync-repeat',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule GitHub metrics sync'));

  // Every 30 minutes — scan GitHub for newly-created repos not yet tracked
  // and auto-onboard them (Notion row, webhook, first audit, Telegram post).
  queue.add('repo-discovery', {}, {
    repeat: { every: 30 * 60 * 1000 },
    jobId:  'repo-discovery-repeat',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule repo discovery'));

  // Daily 6:55am Toronto — record yesterday's brain outcome before today's decision
  queue.add('brain-outcome', {}, {
    repeat: { pattern: '55 6 * * *', tz: SENTINEL_TZ },
    jobId:  'brain-outcome-cron',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule brain outcome cron'));

  // Daily 7am Toronto — strategic brain: gather intel, make decision, auto-execute
  queue.add('brain-strategy', {}, {
    repeat: { pattern: '0 7 * * *', tz: SENTINEL_TZ },
    jobId:  'brain-strategy-cron',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule brain strategy cron'));

  const worker = new Worker('daily-report', async (job: any) => {
    if (job.name === 'morning-briefing') {
      await sendMorningBriefing();
      return;
    }
    if (job.name === 'pull-metrics') {
      await pullAllMetrics();
      if (fetchAllMetrics) await fetchAllMetrics().catch((e: any) => logger.warn({ err: e.message }, 'metricsFetcher failed'));
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
          await new Promise(r => setTimeout(r, 3000));
        } catch (e: any) {
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
      const result = await query(`
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
      const lines = rows.map((r: any) =>
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
      await probeAIProviders().catch((e: any) => logger.warn({ err: e.message }, 'Daily provider health probe failed'));
      return;
    }
    if (job.name === 'github-metrics-sync') {
      await syncAllRepoMetrics().catch((e: any) => logger.warn({ err: e.message }, 'GitHub metrics sync failed'));
      return;
    }
    if (job.name === 'repo-discovery') {
      const { discoverAndOnboardRepos } = require('./repoDiscovery');
      await discoverAndOnboardRepos().catch((e: any) => logger.warn({ err: e.message }, 'Repo discovery failed'));
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
      const alertThreshold = parseFloat(process.env['DAILY_COST_ALERT_USD'] || '5');
      if (dailyCost > alertThreshold) {
        await sendTelegramMessage(
          `💸 Cost Alert — $${dailyCost.toFixed(2)} spent today (limit: $${alertThreshold})\n` +
          `Use /sentinel costs for a full breakdown.`,
          null, null
        ).catch(() => {});
      }
    } catch (e: any) { logger.warn({ err: e.message }, 'Cost alert check failed'); }
    await sendDailyReport();
    await detectPatterns();
    await updateDashboard();
  }, { connection: conn });

  worker.on('failed', (job: any, err: Error) => {
    logger.error({ err: err.message }, 'Daily report worker failed');
  });

  logger.info('Daily report worker started — fires at 9am Toronto');
  return worker;
}

// ── Sprint worker (Sunday 8pm proposal + Wednesday 9am mid-week update) ───────

function startSprintWorker(): Worker | null {
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
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule sprint proposal cron'));

  // Wednesday 9am Toronto — mid-week progress update
  queue.add('midweek', {}, {
    repeat: { pattern: '0 9 * * 3', tz: SENTINEL_TZ },
    jobId:  'sprint-midweek-cron',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule sprint midweek cron'));

  // Sunday 9pm Toronto — Sentinel self-audit (after sprint proposal at 8pm)
  queue.add('self-audit', {}, {
    repeat: { pattern: '0 21 * * 0', tz: SENTINEL_TZ },
    jobId:  'self-audit-cron',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule self-audit cron'));

  const worker = new Worker('sprint', async (job: any) => {
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

  worker.on('failed', (job: any, err: Error) => {
    logger.error({ err: err.message, job: job?.name }, 'Sprint worker job failed');
  });

  logger.info('Sprint worker started — proposes Sunday 8pm, mid-week update Wednesday 9am');
  return worker;
}

// ── Agent cleanup worker (expired file locks every 1h) ────────────────────────

function startAgentCleanupWorker(): void {
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

export = { startBuildPollWorker, startDailyReportWorker, startSprintWorker, startAgentCleanupWorker };
