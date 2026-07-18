import { Worker, Queue } from 'bullmq';
import { getRedisConnection, enqueueBuildCheck } from '../queueClient';
import { safeFire, fireAndForget } from '../utils/safeFire';
import { updatePinnedStatusBoard, sendMorningBriefing } from '../agentRoom';
import { pullAllMetrics } from '../businessMetrics';
import { generateWeeklyReport } from '../weeklyBusinessReport';
import { generateMonthlySecurityReport } from '../monthlySecurityReport';
import { scoreAllQueuedTasks } from '../roiScorer';
import { sendDailyReport } from '../dailyReport';
import { detectPatterns } from '../patternDetector';
import { refreshAllMetrics } from '../portfolioAnalytics';
import { syncAllRepoMetrics } from '../githubMetricsSyncer';
import { updateDashboard } from '../notionDashboard';
import { sendTelegramMessage } from '../telegramClient';
import { triggerAudit } from '../auditOrchestrator';
import logger from '../logger';
import dbClient from '../dbClient';

const { query } = dbClient;

const SENTINEL_TZ = process.env['SENTINEL_TIMEZONE'] || 'America/Toronto';

// Lazy optional module loads (preserve cycle-breaking requires)
let fetchAllMetrics: (() => Promise<void>) | undefined;
try { ({ fetchAllMetrics } = require('../metricsFetcher')); } catch (e: any) { logger.warn({ err: e.message }, 'metricsFetcher failed to load'); }
let runSelfScaler: (() => Promise<void>) | undefined;
try { ({ runSelfScaler } = require('../selfScaler')); } catch (e: any) { logger.warn({ err: e.message }, 'selfScaler failed to load'); }
let runPriorityEngine: (() => Promise<void>) | undefined;
try { ({ runPriorityEngine } = require('../priorityEngine')); } catch (e: any) { logger.warn({ err: e.message }, 'priorityEngine failed to load'); }
let generateCEOReport: ((arg: any) => Promise<void>) | undefined;
try { ({ generateCEOReport } = require('../ceoReport')); } catch (e: any) { logger.warn({ err: e.message }, 'ceoReport failed to load'); }
let runAgentStandup: (() => Promise<void>) | undefined;
try { ({ runAgentStandup } = require('../agentStandup')); } catch (e: any) { logger.warn({ err: e.message }, 'agentStandup failed to load'); }
let postAgentLeaderboard: (() => Promise<void>) | undefined;
try { ({ postAgentLeaderboard } = require('../agentLeaderboard')); } catch (e: any) { logger.warn({ err: e.message }, 'agentLeaderboard failed to load'); }
let runStrategicBrain: ((arg: any) => Promise<void>) | undefined;
let recordBrainOutcome: (() => Promise<void>) | undefined;
try { ({ runStrategicBrain, recordBrainOutcome } = require('../sentinelBrain')); } catch (e: any) { logger.warn({ err: e.message }, 'sentinelBrain failed to load'); }

export function startDailyReportWorker(): Worker | null {
  const conn = getRedisConnection();
  if (!conn) {
    logger.warn('REDIS_URL not configured — daily report worker not started');
    return null;
  }

  const queue = new Queue('daily-report', { connection: conn });

  queue.add('report', {}, {
    repeat:  { pattern: '0 9 * * *', tz: SENTINEL_TZ },
    jobId:   'daily-report-cron',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule daily report cron'));

  queue.add('morning-briefing', {}, {
    repeat: { pattern: '0 8 * * *', tz: SENTINEL_TZ },
    jobId:  'morning-briefing-cron',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule morning briefing cron'));

  queue.add('pull-metrics', {}, {
    repeat: { pattern: '0 6 * * *', tz: SENTINEL_TZ },
    jobId:  'metrics-pull-cron',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule metrics pull cron'));

  queue.add('weekly-report', {}, {
    repeat: { pattern: '0 8 * * 1', tz: SENTINEL_TZ },
    jobId:  'weekly-report-cron',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule weekly report cron'));

  queue.add('monthly-security', {}, {
    repeat: { pattern: '0 8 1 * *', tz: SENTINEL_TZ },
    jobId:  'monthly-security-cron',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule monthly security cron'));

  queue.add('priority-engine', {}, {
    repeat: { pattern: '30 6 * * *', tz: SENTINEL_TZ },
    jobId:  'priority-engine-cron',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule priority engine cron'));

  queue.add('agent-standup', {}, {
    repeat: { pattern: '0 9 * * *', tz: SENTINEL_TZ },
    jobId:  'agent-standup-cron',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule agent standup cron'));

  queue.add('ceo-report', {}, {
    repeat: { pattern: '0 22 * * 0', tz: SENTINEL_TZ },
    jobId:  'ceo-report-cron',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule CEO report cron'));

  queue.add('agent-leaderboard', {}, {
    repeat: { pattern: '30 22 * * 0', tz: SENTINEL_TZ },
    jobId:  'agent-leaderboard-cron',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule agent leaderboard cron'));

  queue.add('weekly-audit', {}, {
    repeat: { pattern: '0 23 * * 0', tz: SENTINEL_TZ },
    jobId:  'weekly-audit-cron',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule weekly audit cron'));

  queue.add('stale-tasks', {}, {
    repeat: { pattern: '0 17 * * 5', tz: SENTINEL_TZ },
    jobId:  'stale-tasks-cron',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule stale tasks cron'));

  queue.add('provider-health', {}, {
    repeat: { pattern: '0 5 * * *', tz: SENTINEL_TZ },
    jobId:  'provider-health-cron',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule provider health cron'));

  queue.add('github-metrics-sync', {}, {
    repeat: { every: 3 * 60 * 60 * 1000 },
    jobId:  'github-metrics-sync-repeat',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule GitHub metrics sync'));

  queue.add('repo-discovery', {}, {
    repeat: { every: 30 * 60 * 1000 },
    jobId:  'repo-discovery-repeat',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule repo discovery'));

  queue.add('brain-outcome', {}, {
    repeat: { pattern: '55 6 * * *', tz: SENTINEL_TZ },
    jobId:  'brain-outcome-cron',
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule brain outcome cron'));

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
      if (runSelfScaler) await safeFire(runSelfScaler(), { label: 'workers' })
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
      const { REPO_LIST } = require('../portfolioAnalytics');
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
      await safeFire(sendTelegramMessage(
        `🔍 Weekly audit sweep — ${audited}/${REPO_LIST.length} repos queued for audit.`,
        null, null
      ), { label: 'workers' })
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
      await safeFire(sendTelegramMessage(
        `🕰️ Stale Task Report — tasks queued >7 days:\n\n${lines}\n\n` +
        `Run: /sentinel force-execute <repo> to execute, or /sentinel skip <repo> to clear.`,
        null, null
      ), { label: 'workers' })
      return;
    }
    if (job.name === 'provider-health') {
      const { probeAIProviders } = require('../providerHealthCheck');
      await probeAIProviders().catch((e: any) => logger.warn({ err: e.message }, 'Daily provider health probe failed'));
      return;
    }
    if (job.name === 'github-metrics-sync') {
      await syncAllRepoMetrics().catch((e: any) => logger.warn({ err: e.message }, 'GitHub metrics sync failed'));
      return;
    }
    if (job.name === 'repo-discovery') {
      const { discoverAndOnboardRepos } = require('../repoDiscovery');
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
    try {
      const { getDailyCost } = require('../portfolioDb');
      const dailyCost      = await getDailyCost();
      const alertThreshold = parseFloat(process.env['DAILY_COST_ALERT_USD'] || '5');
      if (dailyCost > alertThreshold) {
        await safeFire(sendTelegramMessage(
          `💸 Cost Alert — $${dailyCost.toFixed(2)} spent today (limit: $${alertThreshold})\n` +
          `Use /sentinel costs for a full breakdown.`,
          null, null
        ), { label: 'workers' })
      }
    } catch (e: any) { logger.warn({ err: e.message }, 'Cost alert check failed'); }
    await sendDailyReport();
    await detectPatterns();
    await updateDashboard();
  }, { connection: conn });

  worker.on('failed', (job: any, err: Error) => {
    logger.error({ err: err.stack ?? err.message }, 'Daily report worker failed');
  });

  logger.info('Daily report worker started — fires at 9am Toronto');
  return worker;
}
