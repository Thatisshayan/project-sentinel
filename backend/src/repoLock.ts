import logger from './logger';
import { getRedisConnection } from './queueClient';

const LOCK_PREFIX = 'sentinel:repo-lock:';
const LOCK_TTL_MS = 24 * 60 * 60 * 1000; // 24h default

async function lockRepo(repoName: string, reason = 'manual'): Promise<void> {
  const redis = getRedisConnection();
  if (!redis) { logger.warn({ repoName }, 'Redis not available — lock skipped'); return; }
  await redis.set(`${LOCK_PREFIX}${repoName}`, JSON.stringify({
    reason, lockedAt: new Date().toISOString(),
  }), 'PX', LOCK_TTL_MS);
  logger.info({ repoName, reason }, 'Repo locked');
}

async function unlockRepo(repoName: string): Promise<void> {
  const redis = getRedisConnection();
  if (!redis) return;
  await redis.del(`${LOCK_PREFIX}${repoName}`);
  logger.info({ repoName }, 'Repo unlocked');
}

async function isRepoLocked(repoName: string): Promise<any> {
  const redis = getRedisConnection();
  if (!redis) return null;
  const val = await redis.get(`${LOCK_PREFIX}${repoName}`);
  if (!val) return null;
  try { return JSON.parse(val); } catch { return null; }
}

async function getAllLocked(): Promise<any[]> {
  const redis = getRedisConnection();
  if (!redis) return [];
  const keys   = await redis.keys(`${LOCK_PREFIX}*`);
  const locked: any[] = [];
  for (const key of keys) {
    const val = await redis.get(key);
    if (val) {
      try {
        locked.push({ repoName: key.replace(LOCK_PREFIX, ''), ...JSON.parse(val) });
      } catch {}
    }
  }
  return locked;
}

export = { lockRepo, unlockRepo, isRepoLocked, getAllLocked };
