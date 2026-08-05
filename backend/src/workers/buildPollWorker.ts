import { Worker, Job } from 'bullmq';
import type { BuildCheckJobData } from '../types/queueJobs';
import { getRedisConnection, enqueueBuildCheck, enqueueScheduledJob } from '../queueClient';
import { CODERABBIT_FALLBACK_JOB } from './scheduledJobsWorker';
import { releaseExpiredLocks } from '../agentDb';
import { runSelfAudit } from '../selfAuditor';
import { checkAndHeal } from '../selfHealer';
import { pullAllMetrics } from '../businessMetrics';
import { scoreAllQueuedTasks } from '../roiScorer';
import { generateWeeklyReport } from '../weeklyBusinessReport';
import { runSecurityScan } from '../securityScanner';
import { generateMonthlySecurityReport } from '../monthlySecurityReport';
import { checkAllProviders } from '../buildPoller';
import { orchestrateDebug } from '../debugOrchestrator';
import { sendTelegramMessage } from '../telegramClient';
import { findNotionProject, updateNotionProject } from '../notionClient';
import logger from '../logger';
import { triggerAudit, handleBuildPassedAfterSentinelMerge } from '../auditOrchestrator';
import { sendDailyReport } from '../dailyReport';
import { detectPatterns } from '../patternDetector';
import { refreshAllMetrics, refreshRepoMetrics } from '../portfolioAnalytics';
import { syncAllRepoMetrics } from '../githubMetricsSyncer';
import { updateDashboard } from '../notionDashboard';
import { generateSprintProposal } from '../sprintPlanner';
import { recordWeeklyVelocity } from '../velocityTracker';
import dbClient from '../dbClient';
import { safeFire, fireAndForget } from '../utils/safeFire';

const { query } = dbClient;

const SENTINEL_TZ = process.env['SENTINEL_TIMEZONE'] || 'America/Toronto';
const POLL_INTERVAL_MS = 30 * 1000;
const MAX_POLL_ATTEMPTS = 20;

// Each concurrent job that reaches orchestrateDebug() spawns its own aider
// (Python) subprocess via cloneAndFix() — a real CPU/memory cost, and one
// completely uncoordinated with MAX_PARALLEL_AGENTS (parallelExecutor.ts's
// separate task-batch path). The old hardcoded concurrency:5 here, stacked
// on top of that path's own concurrent agents, put up to 8 aider processes
// on the host at once — confirmed live on a 1 OCPU / 1GB Oracle Free-tier
// VM: 5 concurrent aider processes alone were enough to starve the running
// backend/Caddy of CPU/memory and cause real request timeouts (2026-08-05).
const DEBUG_WORKER_CONCURRENCY = (): number => {
  const raw = process.env['DEBUG_WORKER_CONCURRENCY'];
  const parsed = Number(raw);
  if (raw === undefined || !Number.isInteger(parsed) || parsed <= 0) {
    if (raw !== undefined) {
      logger.warn({ raw }, 'DEBUG_WORKER_CONCURRENCY invalid — falling back to 2');
    }
    return 2;
  }
  return parsed;
};

// ── Build poll worker ─────────────────────────────────────────────────────────

export function startBuildPollWorker(): Worker | null {
  const conn = getRedisConnection();
  if (!conn) {
    logger.warn('REDIS_URL not configured — build poll worker not started');
    return null;
  }

  const worker = new Worker('build-poll', async (job: Job<BuildCheckJobData>) => {
    const data = job.data;
    const { repoFullName, commitSha, repoName, projectName,
            topicId = null, attemptNumber = 0 } = data;

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
        await safeFire(sendTelegramMessage(
          `Project Sentinel — Build Timeout ⏱️\n\nRepo: ${repoName}\nBuild still pending after 10 minutes.\nCheck manually: ${result.buildUrl || 'N/A'}`,
          repoName,
          topicId
        ), { label: 'workers' });
        return;
      }

      // Re-queue with incremented attempt count
      await enqueueBuildCheck({
        ...data,
        attemptNumber: attemptNumber + 1,
      }).catch((err: any) =>
        logger.error({ err: err.stack ?? err.message }, 'Failed to re-queue build check')
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

      await safeFire(sendTelegramMessage(
        [
          `Project Sentinel — Build Passed ✅`,
          ``,
          `Project: ${projectName || repoName}`,
          `Repo: ${repoName}`,
          `Commit: ${commitSha.substring(0, 7)}`,
          `Provider: ${result.buildProvider}`,
          result.buildUrl ? `Build: ${result.buildUrl}` : '',
        ].filter(Boolean).join('\n'),
        repoName,
        topicId
      ), { label: 'workers' });

      // Phase 3 — route based on whether this is a Sentinel PR or human commit
      const isSentinelBranch = (data.branchName || '').startsWith('sentinel/');

      if (isSentinelBranch) {
        // Build passed after Sentinel PR was merged — mark tasks done, start next batch
        await handleBuildPassedAfterSentinelMerge(
          repoFullName,
          data.repoName,
          data.branchName,
          topicId
        ).catch((err: any) =>
          logger.error({ err: err.stack ?? err.message }, 'handleBuildPassedAfterSentinelMerge failed')
        );
      } else if (process.env['AUDIT_AGENT_ENABLED'] !== 'false') {
        // Human commit — CodeRabbit (Phase 2, docs/2026-07-22-slack-agent-roster-plan.md)
        // is the primary audit engine and already auto-reviews via its own
        // GitHub App. Rather than running Sentinel's own claudeCodeAudit.ts
        // immediately (redundant if CodeRabbit is going to review anyway),
        // schedule a delayed fallback check: only run Sentinel's audit if
        // CodeRabbit's webhook hasn't produced an audit cycle for this exact
        // commit by the time the delay elapses.
        const auditPayload = {
          repoFullName,
          repoName:      data.repoName,
          projectName:   data.projectName,
          commitSha,
          commitMessage: data.commitMessage,
          branchName:    data.branchName,
          authorName:    data.authorName,
          authorEmail:   data.authorEmail,
          topicId,
        };
        const fallbackDelayMin = parseInt(process.env['CODERABBIT_FALLBACK_DELAY_MIN'] || '45');
        await enqueueScheduledJob(
          CODERABBIT_FALLBACK_JOB,
          { repoFullName, commitSha, auditPayload },
          fallbackDelayMin * 60 * 1000,
          `coderabbit-fallback:${repoFullName}:${commitSha}`
        ).catch((err: any) => {
          // Same failure-visibility principle as auditOrchestrator's
          // scheduleApprovalTimeout — if scheduling the fallback fails, no
          // audit will ever run for this commit unless someone notices and
          // triggers one manually, so make that loud rather than silent.
          logger.error({ err: err.message, repoFullName, commitSha },
            'Failed to schedule CodeRabbit-fallback audit — running Sentinel audit immediately instead as a safety net');
          return triggerAudit(auditPayload).catch((err2: any) =>
            logger.error({ err: err2.stack ?? err2.message }, 'Audit trigger failed')
          );
        });
      }

      // Phase 9 — security scan on every passing build (non-blocking)
      runSecurityScan({
        repoFullName,
        repoName:   data.repoName,
        commitSha,
        branchName: data.branchName,
        topicId:    data.topicId,
      }).catch((err: any) => logger.error({ err: err.stack ?? err.message }, 'Security scan failed'));

      refreshRepoMetrics(repoFullName, repoName)
        .catch((err: any) => logger.warn({ err: err.message }, 'Post-build metrics refresh failed'));

      // Phase 4 — update dashboard on every build result
      fireAndForget(updateDashboard(), { label: 'workers' });
      return;
    }

    if (result.overall === 'failed') {
      logger.info({ repoFullName }, 'Build failed — notifying and triggering debug');

      const isSentinelBranchFailed = (data.branchName || '').startsWith('sentinel/');

      await safeFire(sendTelegramMessage(
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
        repoName,
        topicId
      ), { label: 'workers' });

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
          await safeFire(sendTelegramMessage(
            `🔁 ${count} task(s) re-queued for ${repoName} — use /sentinel tasks ${repoName} to review, then /sentinel force-execute ${repoName} to retry.`,
            repoName, topicId
          ), { label: 'workers' });
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
      fireAndForget(updateDashboard(), { label: 'workers' });
    }

  }, {
    connection:  conn,
    concurrency: DEBUG_WORKER_CONCURRENCY(),
  });

  worker.on('failed', (job: Job<BuildCheckJobData> | undefined, err: Error) => {
    logger.error({ jobId: job?.id, err: err.message }, 'Build poll job failed');
  });

  logger.info('Build poll worker started');
  return worker;
}
