import logger from './logger';

const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 2000;

const store = new Map<string, { ts: number }>();

function makeKey(repoName: string, commitSha: string): string {
  return `${repoName.toLowerCase()}:${commitSha}`;
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

export = { isAlreadyProcessed, markAsProcessed };
