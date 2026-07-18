"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const logger_1 = __importDefault(require("./logger"));
const telegramClient_1 = require("./telegramClient");
const dbClient_1 = __importDefault(require("./dbClient"));
let connection = null;
let lastRedisAlertAt = 0;
function getRedisConnection() {
    if (!connection && process.env['REDIS_URL']) {
        connection = new ioredis_1.default(process.env['REDIS_URL'], {
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
        });
        connection.on('error', (err) => {
            logger_1.default.error({ err: err.stack ?? err.message }, 'Redis connection error');
            const now = Date.now();
            if (now - lastRedisAlertAt > 5 * 60 * 1000) {
                lastRedisAlertAt = now;
                (0, telegramClient_1.sendTelegramMessage)(`Project Sentinel — Redis Error ⚠️\n\nBullMQ jobs (build-poll, debug) may not process until Redis recovers.\nError: ${err.message}`, null, null, true).catch((alertErr) => logger_1.default.error({ err: alertErr.message }, 'Failed to send Redis error alert'));
            }
        });
        connection.on('close', () => {
            logger_1.default.warn('Redis connection closed — will reconnect on next use');
            connection = null;
        });
        connection.on('end', () => {
            logger_1.default.warn('Redis connection ended — will reconnect on next use');
            connection = null;
        });
    }
    return connection;
}
let buildPollQueue = null;
let debugQueue = null;
function getBuildPollQueue() {
    const conn = getRedisConnection();
    if (!conn) {
        return null;
    }
    if (!buildPollQueue) {
        buildPollQueue = new bullmq_1.Queue('build-poll', {
            connection: conn,
            defaultJobOptions: {
                attempts: 1,
                removeOnComplete: { count: 200 },
                removeOnFail: { count: 100 },
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
        debugQueue = new bullmq_1.Queue('debug', {
            connection: conn,
            defaultJobOptions: {
                attempts: 1,
                removeOnComplete: { count: 100 },
                removeOnFail: { count: 50 },
            },
        });
    }
    return debugQueue;
}
async function enqueueBuildCheck(data) {
    const jobId = `build-check:${data.repoFullName}:${data.commitSha}`;
    try {
        const { query: dbQuery } = dbClient_1.default;
        await dbQuery(`
      INSERT INTO build_poll_jobs (job_id, repo_full_name, commit_sha, status)
      VALUES ($1, $2, $3, 'pending')
      ON CONFLICT (job_id) DO NOTHING
    `, [jobId, data.repoFullName, data.commitSha]);
    }
    catch (err) {
        logger_1.default.warn({ err: err.message, jobId }, 'Failed to record build_poll_jobs row — non-blocking');
    }
    const queue = getBuildPollQueue();
    if (!queue) {
        logger_1.default.warn('REDIS_URL not configured — build check queued in DB only, no worker will poll');
        return null;
    }
    const existing = await queue.getJob(jobId);
    if (existing) {
        logger_1.default.info({ jobId }, 'Build check job already exists — skipping');
        return existing;
    }
    return queue.add('check', data, {
        jobId,
        delay: 45000,
    });
}
async function enqueueDebug(data) {
    const queue = getDebugQueue();
    if (!queue) {
        logger_1.default.warn('REDIS_URL not configured — skipping debug queue');
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
//# sourceMappingURL=queueClient.js.map