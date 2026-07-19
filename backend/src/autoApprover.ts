import logger from './logger';
import { getRedisConnection, enqueueScheduledJob, cancelScheduledJob } from './queueClient';
import { loadSettings } from './settingsLoader';
import { AUTO_APPROVE_JOB } from './workers/scheduledJobsWorker';

const AUTO_APPROVE_DELAY_MS = 2 * 60 * 60 * 1000; // 2 hours
const REDIS_KEY = 'sentinel:sprint:pending-auto-approve';
const JOB_ID    = 'auto-approve-sprint';

// Backed by a BullMQ delayed job (queueClient's 'scheduled-jobs' queue),
// which persists in Redis and is processed by whichever worker process is
// running when the delay elapses — unlike a bare setTimeout, this survives
// the Railway redeploys this system triggers on its own merges.
async function scheduleAutoApprove(sprintId: string | number, topicId: string | null): Promise<void> {
  const settings = await loadSettings();

  if (!settings.auto_approve_tasks) return;

  const redis = getRedisConnection();
  if (!redis) { logger.warn('Redis not available — auto-approve skipped'); return; }

  await redis.set(REDIS_KEY, JSON.stringify({ sprintId, topicId }),
    'PX', AUTO_APPROVE_DELAY_MS);

  // Cancel any still-pending job first — BullMQ's add() with a jobId that
  // already has an active job silently keeps the OLD job's delay instead of
  // resetting it. Without this, scheduling a second sprint's auto-approve
  // before the first one fires would leave the first (now-stale) job as the
  // only one in the queue, and the new sprint's approval would never fire —
  // it'd just be silently skipped as "superseded" when the old job runs.
  await cancelScheduledJob(JOB_ID);
  await enqueueScheduledJob(AUTO_APPROVE_JOB, { sprintId, topicId }, AUTO_APPROVE_DELAY_MS, JOB_ID);

  logger.info({ sprintId }, 'Sprint auto-approve scheduled in 2h');
}

async function cancelAutoApprove(): Promise<boolean> {
  const redis = getRedisConnection();
  if (!redis) return false;
  const val = await redis.get(REDIS_KEY);
  if (!val) return false;
  await redis.del(REDIS_KEY);
  await cancelScheduledJob(JOB_ID);
  logger.info('Sprint auto-approve cancelled');
  return true;
}

async function isPendingAutoApprove(): Promise<boolean> {
  const redis = getRedisConnection();
  if (!redis) return false;
  return !!(await redis.get(REDIS_KEY));
}

export = { scheduleAutoApprove, cancelAutoApprove, isPendingAutoApprove };
