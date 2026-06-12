const { Queue, Worker, QueueEvents } = require('bullmq');
const IORedis = require('ioredis');
const logger  = require('./logger');

let connection = null;

function getRedisConnection() {
  if (!connection && process.env.REDIS_URL) {
    connection = new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck:     false,
    });
    connection.on('error', err => {
      logger.error({ err: err.message }, 'Redis connection error');
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
  const queue = getBuildPollQueue();
  if (!queue) {
    logger.warn('REDIS_URL not configured — skipping build check queue');
    return null;
  }

  const jobId = `build-check:${data.repoFullName}:${data.commitSha}`;

  // Do not create duplicate jobs for the same commit
  const existing = await queue.getJob(jobId);
  if (existing) {
    logger.info({ jobId }, 'Build check job already exists — skipping');
    return existing;
  }

  return queue.add('check', data, {
    jobId,
    delay: 5000, // Wait 5s before first check (beat container restarts)
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
