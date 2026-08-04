import logger from '../logger';

// Every NVIDIA-backed builder/agent (nvidia, gpt_oss_120b, llama_8b, ... in
// builderRouter.ts) and ai/client.ts's NVIDIA branch previously read the
// single NVIDIA_API_KEY env var directly, with no shared concurrency
// tracking across callers — see agentRegistry.ts's AGENT_POOL comment for
// how that let an unbounded number of concurrent calls pile onto one
// rate-limited account. This module lets the account be backed by more than
// one key (NVIDIA_API_KEY, NVIDIA_API_KEY_2, NVIDIA_API_KEY_3, ...) and
// enforces a real per-key concurrency cap, so callers fail fast (and fall
// back to the next builder/provider) once every key is saturated instead of
// queuing unboundedly against a rate limit none of them can see.
//
// Keys are read from process.env fresh on every call (matching the rest of
// this codebase's convention of not caching env-derived config at module
// load — see e.g. aiderRunner.ts's TIMEOUT_MS()) so tests that mutate
// process.env between cases behave as expected. Only the active-concurrency
// counters persist across calls, keyed by label rather than array index so
// they survive process.env being re-read each time.

const MAX_NUMBERED_KEYS = 10;

interface KeyEntry {
  key: string;
  label: string;
}

const activeByLabel = new Map<string, number>();

function loadKeys(): KeyEntry[] {
  const keys: KeyEntry[] = [];
  const primary = process.env['NVIDIA_API_KEY'];
  if (primary) keys.push({ key: primary, label: 'NVIDIA_API_KEY' });
  for (let i = 2; i <= MAX_NUMBERED_KEYS; i++) {
    const v = process.env[`NVIDIA_API_KEY_${i}`];
    if (v) keys.push({ key: v, label: `NVIDIA_API_KEY_${i}` });
  }
  return keys;
}

const DEFAULT_PER_KEY_CONCURRENCY = 2;

// parseInt('') and parseInt(non-numeric) both return NaN, and `active >= NaN`
// is always false — an unset-but-present or typo'd NVIDIA_KEY_CONCURRENCY
// would silently remove the cap entirely (every key stays "eligible"
// forever), defeating the reason this module exists. A configured value
// <= 0 would have the opposite failure mode (no key ever acquirable) —
// both fall back to the default instead.
function perKeyConcurrency(): number {
  const parsed = parseInt(process.env['NVIDIA_KEY_CONCURRENCY'] || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PER_KEY_CONCURRENCY;
}

export interface AcquiredNvidiaKey {
  key: string;
  label: string;
  release: () => void;
}

/** Number of configured NVIDIA keys (0 means NVIDIA isn't configured at all). */
export function nvidiaPoolSize(): number {
  return loadKeys().length;
}

/** Labels only (e.g. for health-check/status output) — never the key values themselves. */
export function nvidiaKeyLabels(): string[] {
  return loadKeys().map((k) => k.label);
}

/** Every configured key, paired with its label — for health probes that need to test each key individually. */
export function allNvidiaKeys(): KeyEntry[] {
  return loadKeys();
}

/**
 * Picks the least-loaded configured key with spare capacity (below
 * NVIDIA_KEY_CONCURRENCY, default 2) and reserves a slot on it. Returns
 * null if no key is configured, or every configured key is already at its
 * cap — callers should treat that as "NVIDIA unavailable for this attempt"
 * and fall back to the next builder/provider rather than blocking.
 */
export function acquireNvidiaKey(): AcquiredNvidiaKey | null {
  const keys = loadKeys();
  if (keys.length === 0) return null;

  const cap = perKeyConcurrency();
  let best: KeyEntry | null = null;
  let bestActive = Infinity;
  for (const k of keys) {
    const active = activeByLabel.get(k.label) || 0;
    if (active >= cap) continue;
    if (active < bestActive) {
      best = k;
      bestActive = active;
    }
  }
  if (!best) return null;

  activeByLabel.set(best.label, bestActive + 1);
  const label = best.label;
  let released = false;
  return {
    key: best.key,
    label,
    release: () => {
      if (released) return;
      released = true;
      activeByLabel.set(label, Math.max(0, (activeByLabel.get(label) || 1) - 1));
    },
  };
}

/** Test-only: clear all concurrency bookkeeping between test cases. */
export function __resetPoolForTests(): void {
  activeByLabel.clear();
}
