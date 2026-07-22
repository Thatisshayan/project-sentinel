import { Worker } from 'bullmq';
import { getRedisConnection } from '../queueClient';
import { sendTelegramMessage } from '../telegramClient';
import { approveSprint } from '../sprintOrchestrator';
import logger from '../logger';

const AUTO_APPROVE_JOB       = 'auto-approve-sprint';
const PR_IMPACT_CHECK_JOB    = 'pr-impact-check';
const SPRINT_CONTINUE_JOB    = 'sprint-continue';
const AUDIT_APPROVAL_TIMEOUT_JOB = 'audit-approval-timeout';
const CODERABBIT_FALLBACK_JOB    = 'coderabbit-fallback-audit';

/**
 * The actual job-processing logic, factored out of the BullMQ Worker
 * constructor so it can be unit-tested with plain mock job objects —
 * spinning up a real BullMQ Worker requires a live Redis connection, which
 * isn't available in this test environment.
 */
async function processScheduledJob(job: any): Promise<void> {
  if (job.name === AUTO_APPROVE_JOB) {
    const { sprintId, topicId } = job.data;
    const redis = getRedisConnection();
    const REDIS_KEY = 'sentinel:sprint:pending-auto-approve';
    if (redis) {
      const raw = await redis.get(REDIS_KEY);
      if (!raw) {
        logger.info({ sprintId }, 'Auto-approve job fired but no pending approval found — skipping');
        return;
      }
      const pending = JSON.parse(raw);
      if (pending.sprintId !== sprintId) {
        logger.info({ sprintId, pendingSprintId: pending.sprintId }, 'Auto-approve job fired for a superseded sprint — skipping');
        return;
      }
      await redis.del(REDIS_KEY);
    }
    await sendTelegramMessage(
      '✅ Sprint auto-approved (2h window elapsed). Executing now...',
      null, topicId
    );
    await approveSprint(topicId);
    logger.info({ sprintId }, 'Sprint auto-approved');
    return;
  }

  if (job.name === PR_IMPACT_CHECK_JOB) {
    const { impactId, repoName } = job.data;
    const { checkPostMergeImpact } = require('../correlationEngine');
    await checkPostMergeImpact(impactId, repoName);
    return;
  }

  if (job.name === SPRINT_CONTINUE_JOB) {
    const { sprintId, topicId } = job.data;
    const { executeNextSprintTask } = require('../sprintOrchestrator');
    await executeNextSprintTask(sprintId, topicId);
    return;
  }

  if (job.name === AUDIT_APPROVAL_TIMEOUT_JOB) {
    const { cycleId, repoFullName, repoName, topicId } = job.data;
    const { checkApprovalTimeout } = require('../auditOrchestrator');
    await checkApprovalTimeout(cycleId, repoFullName, repoName, topicId);
    return;
  }

  if (job.name === CODERABBIT_FALLBACK_JOB) {
    const { repoFullName, commitSha, auditPayload } = job.data;
    const { hasCodeRabbitAuditedCommit } = require('../auditDb');
    const alreadyHandled = await hasCodeRabbitAuditedCommit(repoFullName, commitSha).catch((err: any) => {
      logger.error({ err: err.message, repoFullName, commitSha },
        'hasCodeRabbitAuditedCommit check failed — erring toward running the fallback audit rather than silently skipping');
      return false;
    });
    if (alreadyHandled) {
      logger.info({ repoFullName, commitSha }, 'CodeRabbit already audited this commit — skipping Sentinel fallback');
      return;
    }
    logger.info({ repoFullName, commitSha }, 'CodeRabbit webhook never arrived — running Sentinel fallback audit');
    const { triggerAudit } = require('../auditOrchestrator');
    await triggerAudit(auditPayload);
    return;
  }

  logger.warn({ jobName: job.name }, 'Unknown scheduled job type');
}

export function startScheduledJobsWorker(): Worker | null {
  const conn = getRedisConnection();
  if (!conn) {
    logger.warn('REDIS_URL not configured — scheduled jobs worker not started');
    return null;
  }

  const worker = new Worker('scheduled-jobs', processScheduledJob, {
    connection:  conn,
    concurrency: 5,
  });

  worker.on('failed', (job: any, err: Error) => {
    logger.error({ jobId: job?.id, jobName: job?.name, err: err.message }, 'Scheduled job failed');
  });

  logger.info('Scheduled jobs worker started');
  return worker;
}

export { AUTO_APPROVE_JOB, PR_IMPACT_CHECK_JOB, SPRINT_CONTINUE_JOB, AUDIT_APPROVAL_TIMEOUT_JOB, CODERABBIT_FALLBACK_JOB, processScheduledJob };
