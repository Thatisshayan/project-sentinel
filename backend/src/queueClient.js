const { Queue, Worker, QueueEvents } = require('bullmq');
const IORedis = require('ioredis');
const logger  = require('./logger');

let connection;

function getRedisConnection() {
  if (!connection) {
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

let buildPollQueue;
let debugQueue;

function getBuildPollQueue() {
  if (!buildPollQueue) {
    buildPollQueue = new Queue('build-poll', {
      connection: getRedisConnection(),
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
  if (!debugQueue) {
    debugQueue = new Queue('debug', {
      connection: getRedisConnection(),
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
  const queue = getBuildPollQueue();

  // Do not create duplicate jobs for the same commit
  const existing = await queue.getJob(jobId);
  if (existing) {
    logger.info({ jobId }, 'Build check job already exists — skipping');
    return existing;
  }

  return queue.add('check', data, {
    jobId,
    delay: 45000, // Wait 45s before first check
  });
}

async function enqueueDebug(data) {
  const jobId = `debug:${data.repoFullName}:${data.commitSha}:${data.attemptNumber}`;
  return getDebugQueue().add('fix', data, { jobId });
}

module.exports = {
  getRedisConnection,
  getBuildPollQueue,
  getDebugQueue,
  enqueueBuildQueue: enqueueBuildCheck,
  enqueueBuildCheck,
  enqueueDebug,
};
