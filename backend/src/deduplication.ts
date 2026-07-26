import logger from './logger';
import { getRedisConnection } from './queueClient';

const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 2000;

const store = new Map<string, { ts: number }>();

function makeKey(repoName: string, commitSha: string): string {
  return `${repoName.toLowerCase()}:${commitSha}`;
}

// Redis key format: sentinel:dedup:<repoNameLower>:<commitSha>. The
// repoNameLower component mirrors how safeFire/DLQ keys are namespaced, and
// keeps identical commit shas across two different repos from colliding.
function makeRedisKey(repoName: string, commitSha: string): string {
  return `sentinel:dedup:${repoName.toLowerCase()}:${commitSha}`;
}

function pruneExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.ts > TTL_MS) {
      store.delete(key);
    }
  }
}

async function isAlreadyProcessed(repoName: string, commitSha: string): Promise<boolean> {
  const redis = getRedisConnection();
  if (redis) {
    try {
      const rKey = makeRedisKey(repoName, commitSha);
      const exists = await redis.get(rKey);
      if (exists) {
        logger.info({ repoName, commitSha: commitSha.slice(0, 7) }, 'Duplicate event detected (redis)');
        return true;
      }
      return false;
    } catch (err: any) {
      // Fall back to the in-memory store if Redis is reachable-but-broken
      // (e.g. brief network blip) — preserves behavior across the
      // restart-during-redelivery race this dedup is built for.
      logger.warn({ err: err.message, repoName }, 'Redis dedup GET failed — falling back to in-memory');
    }
  }

  const key = makeKey(repoName, commitSha);
  const entry = store.get(key);

  if (!entry) return false;

  if (Date.now() - entry.ts > TTL_MS) {
    store.delete(key);
    return false;
  }

  logger.info({ repoName, commitSha: commitSha.slice(0, 7) }, 'Duplicate event detected');
  return true;
}

async function markAsProcessed(repoName: string, commitSha: string): Promise<void> {
  const redis = getRedisConnection();
  if (redis) {
    try {
      const rKey = makeRedisKey(repoName, commitSha);
      // Plain SET with PX (not NX) — the claim-then-release pattern in
      // processWebhook.ts relies on this mark being present after a
      // successful Notion round-trip, even if a near-simultaneous
      // redelivery already set it. A plain SET refreshes the TTL on a
      // redelivery, which is consistent with that pattern (the TTL window
      // just resets, never shortens below the configured TTL).
      await redis.set(rKey, '1', 'PX', TTL_MS);
      return;
    } catch (err: any) {
      logger.warn({ err: err.message, repoName }, 'Redis dedup SET failed — falling back to in-memory');
    }
  }

  const key = makeKey(repoName, commitSha);
  store.set(key, { ts: Date.now() });

  if (store.size > MAX_ENTRIES) {
    pruneExpired();
    if (store.size > MAX_ENTRIES) {
      const toDelete = [...store.keys()].slice(0, Math.floor(MAX_ENTRIES / 4));
      toDelete.forEach((k: string) => store.delete(k));
    }
  }
}

/**
 * Releases a claim made by markAsProcessed() — used when processing failed
 * in a way that should allow a webhook redelivery to retry (e.g. a
 * transient Notion API error), so the claim-then-release pattern in
 * processWebhook.ts doesn't leave a commit permanently marked "processed"
 * despite nothing actually succeeding.
 */
async function unmarkProcessed(repoName: string, commitSha: string): Promise<void> {
  const redis = getRedisConnection();
  if (redis) {
    try {
      const rKey = makeRedisKey(repoName, commitSha);
      await redis.del(rKey);
      return;
    } catch (err: any) {
      logger.warn({ err: err.message, repoName }, 'Redis dedup DEL failed — falling back to in-memory');
    }
  }

  store.delete(makeKey(repoName, commitSha));
}

export = { isAlreadyProcessed, markAsProcessed, unmarkProcessed };
