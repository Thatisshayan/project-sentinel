import { Queue, Worker, QueueEvents, Job } from 'bullmq';
import IORedis from 'ioredis';
import logger from './logger';
import { sendTelegramMessage } from './telegramClient';
import dbClient from './dbClient';
import type { BuildCheckJobData, DebugJobData } from './types/queueJobs';

let connection: IORedis | null = null;
let lastRedisAlertAt = 0;

function getRedisConnection(): IORedis | null {
  if (!connection && process.env['REDIS_URL']) {
    connection = new IORedis(process.env['REDIS_URL'], {
      maxRetriesPerRequest: null,
      enableReadyCheck:     false,
    });
    connection.on('error', (err: Error) => {
      logger.error({ err: err.stack ?? err.message }, 'Redis connection error');
      const now = Date.now();
      if (now - lastRedisAlertAt > 5 * 60 * 1000) {
        lastRedisAlertAt = now;
        sendTelegramMessage(
          `Project Sentinel — Redis Error ⚠️\n\nBullMQ jobs (build-poll, debug) may not process until Redis recovers.\nError: ${err.message}`,
          null, null, true
        ).catch((alertErr) =>
          logger.error({ err: (alertErr as Error).message }, 'Failed to send Redis error alert')
        );
      }
    });
    connection.on('close', () => {
      logger.warn('Redis connection closed — will reconnect on next use');
      connection = null;
    });
    connection.on('end', () => {
      logger.warn('Redis connection ended — will reconnect on next use');
      connection = null;
    });
  }
  return connection;
}

let buildPollQueue: Queue | null = null;
let debugQueue: Queue | null = null;
let deadLetterQueue: Queue | null = null;
let scheduledJobsQueue: Queue | null = null;

function getBuildPollQueue(): Queue | null {
  const conn = getRedisConnection();
  if (!conn) {
    return null;
  }
  if (!buildPollQueue) {
    buildPollQueue = new Queue('build-poll', {
      connection: conn,
      defaultJobOptions: {
        attempts:    1,
        removeOnComplete: { count: 200 },
        removeOnFail:     { count: 100 },
      },
    });
  }
  return buildPollQueue;
}

function getDebugQueue(): Queue | null {
  const conn = getRedisConnection();
  if (!conn) {
    return null;
  }
  if (!debugQueue) {
    debugQueue = new Queue('debug', {
      connection: conn,
      defaultJobOptions: {
        attempts:    1,
        removeOnComplete: { count: 100 },
        removeOnFail:     { count: 50 },
      },
    });
  }
  return debugQueue;
}

function getDeadLetterQueue(): Queue | null {
  const conn = getRedisConnection();
  if (!conn) {
    return null;
  }
  if (!deadLetterQueue) {
    deadLetterQueue = new Queue('dead-letter', {
      connection: conn,
      defaultJobOptions: {
        attempts:    3,
        backoff:     { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 200 },
        removeOnFail:     { count: 200 },
      },
    });
  }
  return deadLetterQueue;
}

/**
 * Enqueue a failed retryable operation (from safeFire's `retryable: true`
 * option) for later reprocessing. Falls back to a warn log when Redis isn't
 * configured — same pattern as the other queues here — so this never throws
 * back into the safeFire error path itself.
 */
async function enqueueDeadLetter(task: string, payload: unknown): Promise<Job | null> {
  const queue = getDeadLetterQueue();
  if (!queue) {
    logger.warn({ task }, 'REDIS_URL not configured — dead-letter job dropped, not queued');
    return null;
  }
  return queue.add(task, { task, payload, failedAt: new Date().toISOString() }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });
}

/**
 * Long-delay (hours-to-days) scheduled work — auto-approve windows, PR impact
 * checks, etc. Backed by a BullMQ delayed job, which persists in Redis and is
 * picked up by whichever worker process is running when the delay elapses —
 * unlike a bare setTimeout, this survives the Railway redeploys this system
 * triggers on its own merges.
 */
function getScheduledJobsQueue(): Queue | null {
  const conn = getRedisConnection();
  if (!conn) {
    return null;
  }
  if (!scheduledJobsQueue) {
    scheduledJobsQueue = new Queue('scheduled-jobs', {
      connection: conn,
      defaultJobOptions: {
        attempts:    3,
        backoff:     { type: 'exponential', delay: 60000 },
        removeOnComplete: { count: 200 },
        removeOnFail:     { count: 200 },
      },
    });
  }
  return scheduledJobsQueue;
}

/**
 * BullMQ rejects a custom jobId containing ':' ("Custom Id cannot contain :"
 * — it uses colons internally in Redis key naming). Every call site in this
 * file built jobIds like `audit-approval-timeout:${cycleId}` or
 * `debug:${repoFullName}:${commitSha}:${attemptNumber}` — confirmed live
 * 2026-07-29 that this throws and silently drops the scheduled job (no
 * automatic expiry ever gets armed). Sanitize centrally here so every
 * caller is fixed without touching each jobId string literal individually.
 */
function sanitizeJobId(jobId: string): string {
  return jobId.replace(/:/g, '-');
}

async function enqueueScheduledJob(jobType: string, data: Record<string, unknown>, delayMs: number, jobId?: string): Promise<Job | null> {
  const queue = getScheduledJobsQueue();
  if (!queue) {
    logger.warn({ jobType }, 'REDIS_URL not configured — scheduled job dropped, not queued');
    return null;
  }
  return queue.add(jobType, data, { delay: delayMs, ...(jobId ? { jobId: sanitizeJobId(jobId) } : {}) });
}

async function cancelScheduledJob(jobId: string): Promise<boolean> {
  const queue = getScheduledJobsQueue();
  if (!queue) return false;
  const job = await queue.getJob(sanitizeJobId(jobId));
  if (!job) return false;
  await job.remove();
  return true;
}

async function enqueueBuildCheck(data: BuildCheckJobData): Promise<Job | null> {
  const jobId = sanitizeJobId(`build-check:${data.repoFullName}:${data.commitSha}`);

  try {
    const { query: dbQuery } = dbClient;
    await dbQuery(`
      INSERT INTO build_poll_jobs (job_id, repo_full_name, commit_sha, status)
      VALUES ($1, $2, $3, 'pending')
      ON CONFLICT (job_id) DO NOTHING
    `, [jobId, data.repoFullName, data.commitSha]);
  } catch (err) {
    logger.warn({ err: (err as Error).message, jobId }, 'Failed to record build_poll_jobs row — non-blocking');
  }

  const queue = getBuildPollQueue();
  if (!queue) {
    logger.warn('REDIS_URL not configured — build check queued in DB only, no worker will poll');
    return null;
  }

  const existing = await queue.getJob(jobId);
  if (existing) {
    logger.info({ jobId }, 'Build check job already exists — skipping');
    return existing;
  }

  return queue.add('check', data, {
    jobId,
    delay: 45000,
  });
}

async function enqueueDebug(data: DebugJobData): Promise<Job | null> {
  const queue = getDebugQueue();
  if (!queue) {
    logger.warn('REDIS_URL not configured — skipping debug queue');
    return null;
  }

  const jobId = sanitizeJobId(`debug:${data.repoFullName}:${data.commitSha}:${data.attemptNumber}`);
  return queue.add('fix', data, { jobId });
}

export = {
  getRedisConnection,
  getBuildPollQueue,
  getDebugQueue,
  getDeadLetterQueue,
  getScheduledJobsQueue,
  enqueueBuildQueue: enqueueBuildCheck,
  enqueueBuildCheck,
  enqueueDebug,
  enqueueDeadLetter,
  enqueueScheduledJob,
  cancelScheduledJob,
};

