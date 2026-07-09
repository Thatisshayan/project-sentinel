const { Queue, Worker, QueueEvents } = require('bullmq');
const IORedis = require('ioredis');
const logger  = require('./logger');

let connection = null;
let lastRedisAlertAt = 0;

function getRedisConnection() {
  if (!connection && process.env.REDIS_URL) {
    connection = new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck:     false,
    });
    connection.on('error', err => {
      logger.error({ err: err.message }, 'Redis connection error');
      const now = Date.now();
      if (now - lastRedisAlertAt > 5 * 60 * 1000) {
        lastRedisAlertAt = now;
        const { sendTelegramMessage } = require('./telegramClient');
        sendTelegramMessage(
          `Project Sentinel — Redis Error ⚠️\n\nBullMQ jobs (build-poll, debug) may not process until Redis recovers.\nError: ${err.message}`,
          null, null, true
        ).catch(alertErr =>
          logger.error({ err: alertErr.message }, 'Failed to send Redis error alert')
        );
      }
    });
  }
  return connection;
}

// ── Queues ───────────────────────────────────────────────────────────────────

let buildPollQueue = null;
let debugQueue = null;

function getBuildPollQueue() {
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

function getDebugQueue() {
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

// ── Job creators ─────────────────────────────────────────────────────────────

async function enqueueBuildCheck(data) {
  const jobId = `build-check:${data.repoFullName}:${data.commitSha}`;

  // Always write the DB row — health-score analytics (portfolioAnalytics.getRepoStats)
  // counts build_poll_jobs rows to compute pass rate. This must happen even when Redis
  // is not configured, otherwise all repos stay at the 6.5 default score forever.
  try {
    const { query: dbQuery } = require('./dbClient');
    await dbQuery(`
      INSERT INTO build_poll_jobs (job_id, repo_full_name, commit_sha, status)
      VALUES ($1, $2, $3, 'pending')
      ON CONFLICT (job_id) DO NOTHING
    `, [jobId, data.repoFullName, data.commitSha]);
  } catch (err) {
    logger.warn({ err: err.message, jobId }, 'Failed to record build_poll_jobs row — non-blocking');
  }

  const queue = getBuildPollQueue();
  if (!queue) {
    logger.warn('REDIS_URL not configured — build check queued in DB only, no worker will poll');
    return null;
  }

  // Do not create duplicate jobs for the same commit
  const existing = await queue.getJob(jobId);
  if (existing) {
    logger.info({ jobId }, 'Build check job already exists — skipping');
    return existing;
  }

  return queue.add('check', data, {
    jobId,
    delay: 45000, // Wait 45s before first check — GitHub Actions takes 20-40s to register a run
  });
}

async function enqueueDebug(data) {
  const queue = getDebugQueue();
  if (!queue) {
    logger.warn('REDIS_URL not configured — skipping debug queue');
    return null;
  }

  const jobId = `debug:${data.repoFullName}:${data.commitSha}:${data.attemptNumber}`;
  return queue.add('fix', data, { jobId });
}

module.exports = {
  getRedisConnection,
  getBuildPollQueue,
  getDebugQueue,
  enqueueBuildQueue: enqueueBuildCheck,
  enqueueBuildCheck,
  enqueueDebug,
};
