// Mock getRedisConnection so tests can drive both the Redis-backed path and
// the in-memory fallback. The mock factory returns an object whose
// `getRedisConnection` function is overridden per-test via jest.doMock after
// jest.resetModules (so the deduplication module re-evaluates and re-imports
// the freshly-mocked queueClient).

function makeRedisMock() {
  const store = new Map<string, string>();
  const redis: any = {
    get: jest.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
    set: jest.fn((k: string, _v: string, ..._rest: any[]) => {
      store.set(k, '1');
      return Promise.resolve('OK');
    }),
    del: jest.fn((k: string) => {
      const had = store.has(k);
      store.delete(k);
      return Promise.resolve(had ? 1 : 0);
    }),
  };
  return { redis, store };
}

describe('deduplication — Redis-backed', () => {
  let dedup: any;
  let redis: any;
  let store: Map<string, string>;
  let mockGetRedis: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    ({ redis, store } = makeRedisMock());
    mockGetRedis = jest.fn(() => redis);
    jest.doMock('../src/queueClient', () => ({ getRedisConnection: mockGetRedis }));
    jest.doMock('../src/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    dedup = require('../src/deduplication');
  });

  test('isAlreadyProcessed returns false when the Redis key does not exist', async () => {
    const result = await dedup.isAlreadyProcessed('tapcash', 'sha-AAA');
    expect(result).toBe(false);
    expect(redis.get).toHaveBeenCalledWith('sentinel:dedup:tapcash:sha-AAA');
  });

  test('isAlreadyProcessed returns true when markAsProcessed has set the Redis key', async () => {
    await dedup.markAsProcessed('tapcash', 'sha-BBB');
    expect(redis.set).toHaveBeenCalledWith('sentinel:dedup:tapcash:sha-BBB', '1', 'PX', 10 * 60 * 1000);
    const result = await dedup.isAlreadyProcessed('tapcash', 'sha-BBB');
    expect(result).toBe(true);
  });

  test('unmarkProcessed calls redis.del and clears the key so isAlreadyProcessed returns false', async () => {
    await dedup.markAsProcessed('tapcash', 'sha-CCC');
    expect(await dedup.isAlreadyProcessed('tapcash', 'sha-CCC')).toBe(true);

    await dedup.unmarkProcessed('tapcash', 'sha-CCC');
    expect(redis.del).toHaveBeenCalledWith('sentinel:dedup:tapcash:sha-CCC');
    expect(await dedup.isAlreadyProcessed('tapcash', 'sha-CCC')).toBe(false);
  });

  test('repoName is lowercased before being placed in the Redis key', async () => {
    await dedup.markAsProcessed('TapCash', 'sha-X');
    expect(redis.set).toHaveBeenCalledWith('sentinel:dedup:tapcash:sha-X', '1', 'PX', 10 * 60 * 1000);
  });

  test('M-3 regression: the mark survives an in-memory store reset (process restart) — Redis is the source of truth', async () => {
    // Simulate a process restart by clearing any in-memory state. The
    // deduplication module's internal Map is module-private, so we clear
    // it indirectly: call markAsProcessed, then reset modules entirely so
    // a fresh in-memory Map is allocated, then ask isAlreadyProcessed.
    await dedup.markAsProcessed('tapcash', 'sha-restart-1');
    expect(await dedup.isAlreadyProcessed('tapcash', 'sha-restart-1')).toBe(true);

    jest.resetModules();
    // Re-mock queueClient to keep returning the SAME redis instance so the
    // key written before the restart is still readable.
    jest.doMock('../src/queueClient', () => ({ getRedisConnection: mockGetRedis }));
    jest.doMock('../src/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    dedup = require('../src/deduplication');

    // Without Redis this would return false (fresh in-memory Map, restart
    // state lost). With Redis backing, the mark survives.
    const result = await dedup.isAlreadyProcessed('tapcash', 'sha-restart-1');
    expect(result).toBe(true);
  });

  test('falls back to in-memory when Redis GET rejects (Redis reachable but broken)', async () => {
    redis.get.mockRejectedValueOnce(new Error('ECONNRESET'));
    // No mark in the in-memory store yet.
    const result = await dedup.isAlreadyProcessed('tapcash', 'sha-fallback');
    expect(result).toBe(false);
  });

  test('falls back to in-memory when Redis SET rejects — mark still takes effect in the in-memory Map', async () => {
    redis.set.mockRejectedValueOnce(new Error('ECONNRESET'));
    await dedup.markAsProcessed('tapcash', 'sha-fallback-set');
    // The in-memory write happened; Redis is broken so GET will also fall back.
    redis.get.mockRejectedValueOnce(new Error('ECONNRESET'));
    const result = await dedup.isAlreadyProcessed('tapcash', 'sha-fallback-set');
    expect(result).toBe(true);
  });

  test('falls back to in-memory when Redis DEL rejects — unmark still removes the in-memory entry', async () => {
    redis.set.mockRejectedValueOnce(new Error('ECONNRESET'));
    await dedup.markAsProcessed('tapcash', 'sha-fallback-del');
    redis.del.mockRejectedValueOnce(new Error('ECONNRESET'));
    await dedup.unmarkProcessed('tapcash', 'sha-fallback-del');
    redis.get.mockRejectedValueOnce(new Error('ECONNRESET'));
    expect(await dedup.isAlreadyProcessed('tapcash', 'sha-fallback-del')).toBe(false);
  });
});

describe('deduplication — in-memory fallback (Redis unconfigured)', () => {
  let dedup: any;
  let mockGetRedis: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    mockGetRedis = jest.fn(() => null);
    jest.doMock('../src/queueClient', () => ({ getRedisConnection: mockGetRedis }));
    jest.doMock('../src/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    dedup = require('../src/deduplication');
  });

  test('isAlreadyProcessed returns false when no mark has been set', async () => {
    // isAlreadyProcessed is a pure read — it does not claim or release anything.
    expect(await dedup.isAlreadyProcessed('tapcash', 'sha-1')).toBe(false);
  });

  test('markAsProcessed marks the in-memory entry', async () => {
    // markAsProcessed writes the in-memory entry directly, which is exactly
    // why isAlreadyProcessed sees it as a duplicate on the next read.
    await dedup.markAsProcessed('tapcash', 'sha-2');
    expect(await dedup.isAlreadyProcessed('tapcash', 'sha-2')).toBe(true);
  });

  test('unmarkProcessed clears the in-memory entry', async () => {
    // First claim and hold the slot (simulating actual processing)
    const claimed = await dedup.claimProcessing('tapcash', 'sha-3');
    expect(claimed).toBe(true);
    
    // Now isAlreadyProcessed will return true (it finds the existing entry as duplicate)
    expect(await dedup.isAlreadyProcessed('tapcash', 'sha-3')).toBe(true);
    
    // unmarkProcessed should clear it
    await dedup.unmarkProcessed('tapcash', 'sha-3');
    // After unmark, a fresh claimProcessing should succeed
    const claimedAgain = await dedup.claimProcessing('tapcash', 'sha-3');
    expect(claimedAgain).toBe(true);
  });

  test('repoName is case-insensitive — TapCash and tapcash share the same mark', async () => {
    const claimed1 = await dedup.claimProcessing('TapCash', 'sha-4');
    expect(claimed1).toBe(true);
    
    // Same repo, different case - should be duplicate
    const claimed2 = await dedup.claimProcessing('tapcash', 'sha-4');
    expect(claimed2).toBe(false);
    
    const claimed3 = await dedup.claimProcessing('TAPCASH', 'sha-4');
    expect(claimed3).toBe(false);
  });

  test('a different commitSha for the same repo is treated as a separate event', async () => {
    const claimed1 = await dedup.claimProcessing('tapcash', 'sha-A');
    expect(claimed1).toBe(true);
    
    // Different sha - should be a new event
    const claimed2 = await dedup.claimProcessing('tapcash', 'sha-B');
    expect(claimed2).toBe(true);
    
    // Original sha - duplicate
    const claimed3 = await dedup.claimProcessing('tapcash', 'sha-A');
    expect(claimed3).toBe(false);
  });

  test('an expired entry in the in-memory Map returns false from isAlreadyProcessed (TTL of 10 minutes)', async () => {
    const realNow = Date.now;
    const TTL_MS = 10 * 60 * 1000;
    let mockNow = 1_000_000;
    Date.now = jest.fn(() => mockNow) as any;

    try {
      // Claim the slot
      const claimed = await dedup.claimProcessing('tapcash', 'sha-expired');
      expect(claimed).toBe(true);
      
      // Advance past the TTL window.
      mockNow += TTL_MS + 1;
      // isAlreadyProcessed claims and releases - should return false for expired
      const result = await dedup.isAlreadyProcessed('tapcash', 'sha-expired');
      expect(result).toBe(false);
    } finally {
      Date.now = realNow;
    }
  });

  test('an entry just inside the TTL window is still considered processed', async () => {
    const realNow = Date.now;
    const TTL_MS = 10 * 60 * 1000;
    let mockNow = 5_000_000;
    Date.now = jest.fn(() => mockNow) as any;

    try {
      const claimed = await dedup.claimProcessing('tapcash', 'sha-inside-ttl');
      expect(claimed).toBe(true);
      
      // Advance by less than the TTL.
      mockNow += TTL_MS - 1;
      // isAlreadyProcessed finds existing entry and returns true (duplicate)
      const result = await dedup.isAlreadyProcessed('tapcash', 'sha-inside-ttl');
      expect(result).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });

  test('M-3 regression (no-Redis case): the mark does NOT survive a process restart (this is the bug — proven)', async () => {
    const claimed = await dedup.claimProcessing('tapcash', 'sha-restart-noredis');
    expect(claimed).toBe(true);
    // isAlreadyProcessed finds existing entry and returns true (duplicate)
    expect(await dedup.isAlreadyProcessed('tapcash', 'sha-restart-noredis')).toBe(true);

    // Restart: fresh in-memory Map allocated, queueClient still returns null.
    jest.resetModules();
    jest.doMock('../src/queueClient', () => ({ getRedisConnection: jest.fn(() => null) }));
    jest.doMock('../src/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    dedup = require('../src/deduplication');

    // Without Redis backing the mark is lost — exactly the M-3 bug we
    // fixed for the Redis-backed path. Documenting the old (broken)
    // behavior in the no-Redis path keeps the contrast visible.
    const result = await dedup.isAlreadyProcessed('tapcash', 'sha-restart-noredis');
    expect(result).toBe(false);
  });
});

describe('deduplication — function signatures unchanged', () => {
  let dedup: any;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../src/queueClient', () => ({ getRedisConnection: () => null }));
    jest.doMock('../src/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    dedup = require('../src/deduplication');
  });

  test('exports isAlreadyProcessed, markAsProcessed, unmarkProcessed, claimProcessing', () => {
    expect(typeof dedup.isAlreadyProcessed).toBe('function');
    expect(typeof dedup.markAsProcessed).toBe('function');
    expect(typeof dedup.unmarkProcessed).toBe('function');
    expect(typeof dedup.claimProcessing).toBe('function');
  });
});
