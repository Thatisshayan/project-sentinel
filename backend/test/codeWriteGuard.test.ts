import fs from 'fs';
import os from 'os';
import path from 'path';
import { simpleGit } from 'simple-git';

jest.mock('../src/logger', () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const store = new Map<string, number>();
const redis = {
  incr:   jest.fn(async (k: string) => { const v = (store.get(k) || 0) + 1; store.set(k, v); return v; }),
  decr:   jest.fn(async (k: string) => { const v = (store.get(k) || 0) - 1; store.set(k, v); return v; }),
  expire: jest.fn(async () => 1),
};
let redisAvailable = true;
jest.mock('../src/queueClient', () => ({ getRedisConnection: () => (redisAvailable ? redis : null) }));

import guard from '../src/codeWriteGuard';

describe('codeWritingEnabled', () => {
  afterEach(() => { delete process.env['BUILDER_AGENT_ENABLED']; });
  it('is on by default and off only for the exact value "false"', () => {
    expect(guard.codeWritingEnabled()).toBe(true);
    process.env['BUILDER_AGENT_ENABLED'] = 'true';
    expect(guard.codeWritingEnabled()).toBe(true);
    process.env['BUILDER_AGENT_ENABLED'] = 'false';
    expect(guard.codeWritingEnabled()).toBe(false);
  });
});

describe('findBrokenConfigFiles', () => {
  let dir: string;
  let base: string;
  const git = () => simpleGit(dir);
  const write = (f: string, s: string) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s); };

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwg-'));
    await git().init();
    await git().addConfig('user.email', 't@t');
    await git().addConfig('user.name', 't');
    write('eas.json', '{"build": {"production": {}}}\n');
    write('tsconfig.json', '{ // comments: not strict JSON\n "compilerOptions": {} }\n');
    write('.github/workflows/ci.yml', 'on: push\njobs: {}\n');
    write('README.md', '# hi\n');
    await git().add('.');
    await git().commit('base');
    base = (await git().revparse(['HEAD'])).trim();
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const commitAndCheck = async () => {
    await git().add('.');
    await git().commit('change');
    return guard.findBrokenConfigFiles(git(), dir, base);
  };

  it('passes valid edits', async () => {
    write('eas.json', '{"build": {"production": {"channel": "prod"}}}\n');
    write('.github/workflows/ci.yml', 'on: [push, pull_request]\njobs: {}\n');
    write('README.md', 'not { json');
    expect(await commitAndCheck()).toEqual([]);
  });

  it('flags a JSON file the change broke (the eas.json case)', async () => {
    write('eas.json', '{"build": {"production": {},}\n');
    const broken = await commitAndCheck();
    expect(broken.map(b => b.file)).toEqual(['eas.json']);
  });

  it('flags a YAML file the change broke', async () => {
    write('.github/workflows/ci.yml', 'on: push\njobs: {\n  bad: [\n');
    expect((await commitAndCheck()).map(b => b.file)).toEqual(['.github/workflows/ci.yml']);
  });

  it('flags a new config file that does not parse', async () => {
    write('app.json', '{ nope');
    expect((await commitAndCheck()).map(b => b.file)).toEqual(['app.json']);
  });

  it('ignores files that were not strict JSON before (tsconfig with comments)', async () => {
    write('tsconfig.json', '{ // still comments\n "compilerOptions": { "strict": true } }\n');
    expect(await commitAndCheck()).toEqual([]);
  });

  it('returns nothing without a base ref', async () => {
    expect(await guard.findBrokenConfigFiles(git(), dir, null)).toEqual([]);
  });
});

describe('reservePrSlot', () => {
  beforeEach(() => { store.clear(); redisAvailable = true; delete process.env['MAX_SENTINEL_PRS_PER_REPO_PER_DAY']; });

  it('allows 3 PRs per repo per day by default, then refuses', async () => {
    for (let i = 0; i < 3; i++) expect((await guard.reservePrSlot('o/app')).ok).toBe(true);
    const fourth = await guard.reservePrSlot('o/app');
    expect(fourth.ok).toBe(false);
    // the refused attempt doesn't use up a slot
    expect([...store.values()]).toEqual([3]);
    // other repos have their own count
    expect((await guard.reservePrSlot('o/other')).ok).toBe(true);
  });

  it('respects MAX_SENTINEL_PRS_PER_REPO_PER_DAY, including 0', async () => {
    process.env['MAX_SENTINEL_PRS_PER_REPO_PER_DAY'] = '1';
    expect((await guard.reservePrSlot('o/app')).ok).toBe(true);
    expect((await guard.reservePrSlot('o/app')).ok).toBe(false);
    process.env['MAX_SENTINEL_PRS_PER_REPO_PER_DAY'] = '0';
    expect((await guard.reservePrSlot('o/new')).ok).toBe(false);
  });

  it('fails closed when the counter is unavailable', async () => {
    redisAvailable = false;
    expect((await guard.reservePrSlot('o/app')).ok).toBe(false);
    redisAvailable = true;
    redis.incr.mockRejectedValueOnce(new Error('down'));
    expect((await guard.reservePrSlot('o/app')).ok).toBe(false);
  });
});
