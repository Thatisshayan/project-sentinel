import logger from './logger';
import { getRedisConnection } from './queueClient';
import { sendTelegramMessage } from './telegramClient';
import { approveSprint } from './sprintOrchestrator';
import { loadSettings } from './settingsLoader';

const AUTO_APPROVE_DELAY_MS = 2 * 60 * 60 * 1000; // 2 hours
const REDIS_KEY = 'sentinel:sprint:pending-auto-approve';

async function scheduleAutoApprove(sprintId: string | number, topicId: string | null): Promise<void> {
  const settings = await loadSettings();

  if (!settings.auto_approve_tasks) return;

  const redis = getRedisConnection();
  if (!redis) { logger.warn('Redis not available — auto-approve skipped'); return; }

  await redis.set(REDIS_KEY, JSON.stringify({ sprintId, topicId }),
    'PX', AUTO_APPROVE_DELAY_MS);

  logger.info({ sprintId }, 'Sprint auto-approve scheduled in 2h');

  setTimeout(async () => {
    try {
      const redis2 = getRedisConnection();
      if (!redis2) return;

      const val = await redis2.get(REDIS_KEY);
      if (!val) return;

      const data = JSON.parse(val);
      if (data.sprintId !== sprintId) return;

      await redis2.del(REDIS_KEY);
      await sendTelegramMessage(
        '✅ Sprint auto-approved (2h window elapsed). Executing now...',
        null, data.topicId
      );
      await approveSprint(data.topicId);
      logger.info({ sprintId }, 'Sprint auto-approved');
    } catch (err: any) {
      logger.error({ err: err.stack ?? err.message }, 'Auto-approve failed');
    }
  }, AUTO_APPROVE_DELAY_MS);
}

async function cancelAutoApprove(): Promise<boolean> {
  const redis = getRedisConnection();
  if (!redis) return false;
  const val = await redis.get(REDIS_KEY);
  if (!val) return false;
  await redis.del(REDIS_KEY);
  logger.info('Sprint auto-approve cancelled');
  return true;
}

async function isPendingAutoApprove(): Promise<boolean> {
  const redis = getRedisConnection();
  if (!redis) return false;
  return !!(await redis.get(REDIS_KEY));
}

export = { scheduleAutoApprove, cancelAutoApprove, isPendingAutoApprove };

