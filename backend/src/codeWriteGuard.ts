// Guardrails shared by every path that writes code into a repo and opens a
// PR (audit tasks, sprint tasks, build-failure auto-fix, security patches).
//
// Added 2026-11-04 after the auto-fix bot, falling back to small models,
// opened 16 bad PRs and broke a repo's eas.json. Three checks:
//   1. One master switch: BUILDER_AGENT_ENABLED=false stops all of them.
//   2. A pushed change may not turn a parseable JSON/YAML file into an
//      unparseable one.
//   3. A per-repo cap on Sentinel PRs per UTC day.

import fs from 'node:fs';
import path from 'node:path';
import type { SimpleGit } from 'simple-git';
import { parse as parseYaml } from 'yaml';
import logger from './logger';

const CODE_WRITING_DISABLED_REASON =
  'Code writing is paused (BUILDER_AGENT_ENABLED=false). Set it to true in backend/.env to resume.';

function codeWritingEnabled(): boolean {
  return process.env['BUILDER_AGENT_ENABLED'] !== 'false';
}

// ── 2. config files must still parse ─────────────────────────────────────

const JSON_EXT = new Set(['.json']);
const YAML_EXT = new Set(['.yml', '.yaml']);

type ParseResult = { ok: true } | { ok: false; error: string };

function tryParse(file: string, text: string): ParseResult | null {
  const ext = path.extname(file).toLowerCase();
  const body = text.replace(/^﻿/, '');
  try {
    if (JSON_EXT.has(ext)) { JSON.parse(body); return { ok: true }; }
    if (YAML_EXT.has(ext)) { parseYaml(body); return { ok: true }; }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  return null; // not a config file we check
}

/**
 * Files changed between `baseRef` and HEAD that were valid JSON/YAML before
 * (or are new) and no longer parse. A file that didn't parse strictly
 * before (e.g. a tsconfig.json with comments) is skipped, so this only
 * catches breakage the change itself introduced.
 */
async function findBrokenConfigFiles(
  repoGit: SimpleGit, repoPath: string, baseRef: string | null,
): Promise<Array<{ file: string; error: string }>> {
  if (!baseRef) return [];
  const diff = await repoGit.diff(['--name-only', '--diff-filter=AM', baseRef, 'HEAD']);
  const files = diff.split('\n').map(f => f.trim()).filter(Boolean);
  const broken: Array<{ file: string; error: string }> = [];

  for (const file of files) {
    const abs = path.join(repoPath, file);
    let after: string;
    try { after = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    const now = tryParse(file, after);
    if (!now || now.ok) continue;

    let before: string | null = null;
    try { before = await repoGit.show([`${baseRef}:${file}`]); } catch { before = null; }
    const was = before === null ? { ok: true } : tryParse(file, before);
    if (was && was.ok) broken.push({ file, error: now.error.slice(0, 200) });
  }
  return broken;
}

// ── 3. per-repo daily PR cap ─────────────────────────────────────────────

const DEFAULT_DAILY_PR_CAP = 3;
const REDIS_TIMEOUT_MS = 3000;

function dailyPrCap(): number {
  const n = parseInt(process.env['MAX_SENTINEL_PRS_PER_REPO_PER_DAY'] || '', 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_PR_CAP;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

/**
 * Claims one of today's PR slots for `repoFullName`. Fails closed: if the
 * counter can't be reached, no PR is opened.
 */
async function reservePrSlot(repoFullName: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const cap = dailyPrCap();
  if (cap === 0) return { ok: false, reason: 'Sentinel PRs are capped at 0 per day (MAX_SENTINEL_PRS_PER_REPO_PER_DAY=0)' };

  const { getRedisConnection } = require('./queueClient') as { getRedisConnection: () => import('ioredis').default | null };
  const redis = getRedisConnection();
  if (!redis) return { ok: false, reason: 'PR cap counter unavailable (REDIS_URL not set) — not opening a PR' };

  const day = new Date().toISOString().slice(0, 10);
  const key = `sentinel:pr-cap:${repoFullName.toLowerCase()}:${day}`;
  try {
    const count = await withTimeout(redis.incr(key), REDIS_TIMEOUT_MS);
    if (count === 1) await withTimeout(redis.expire(key, 2 * 24 * 3600), REDIS_TIMEOUT_MS);
    if (count > cap) {
      await withTimeout(redis.decr(key), REDIS_TIMEOUT_MS).catch(() => undefined);
      return { ok: false, reason: `Daily cap reached: ${cap} Sentinel PRs already opened on ${repoFullName} today (UTC)` };
    }
    return { ok: true };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), repoFullName }, 'codeWriteGuard: PR cap counter failed');
    return { ok: false, reason: 'PR cap counter unavailable — not opening a PR' };
  }
}

export = {
  CODE_WRITING_DISABLED_REASON,
  codeWritingEnabled,
  findBrokenConfigFiles,
  reservePrSlot,
  dailyPrCap,
};
