/**
 * Real-filesystem test (not mocked) against a fake boardroom repo shaped
 * like OBSIDIAN-TEAM-BOARDROOM's ledger/ (pool.md table + tasks/ dir) —
 * verifies the create/update dual-write (task file + pool.md row) and the
 * postgresTaskId -> ledger file mapping used to route status updates back
 * to the right file.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

const POOL_FIXTURE = [
  '# TASK POOL — Open / Unclaimed',
  '',
  '| ID | Title | Priority | Status | Owner |',
  '|----|-------|----------|--------|-------|',
  '| 010 | Existing task | high | proposed | unassigned |',
  '',
  'DONE: 001-009',
  '',
  'Add tasks here, then promote to `ledger/tasks/<NNN>-<slug>.md` when claimed.',
  '',
].join('\n');

function makeFakeBoardroom(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boardroom-test-'));
  fs.mkdirSync(path.join(dir, 'ledger', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'ledger', 'pool.md'), POOL_FIXTURE, 'utf8');
  // Pre-existing task file so nextLedgerNumber() has something to scan past.
  fs.writeFileSync(path.join(dir, 'ledger', 'tasks', '010-existing-task.md'), '---\nid: TASK-010\n---\n', 'utf8');
  return dir;
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('obsidianLedgerWriter', () => {
  let boardroomDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    boardroomDir = makeFakeBoardroom();
    originalEnv = process.env['OBSIDIAN_BOARDROOM_PATH'];
    process.env['OBSIDIAN_BOARDROOM_PATH'] = boardroomDir;
    jest.resetModules();
  });

  afterEach(() => {
    cleanup(boardroomDir);
    if (originalEnv === undefined) delete process.env['OBSIDIAN_BOARDROOM_PATH'];
    else process.env['OBSIDIAN_BOARDROOM_PATH'] = originalEnv;
  });

  it('creates a ledger task file with the next id and a matching pool.md row', async () => {
    const { createLedgerTask } = require('../src/obsidianLedgerWriter');
    await createLedgerTask({
      postgresTaskId: 42,
      repoFullName: 'Thatisshayan/costpilot',
      title: 'Fix SSL config in dbClient',
      description: 'rejectUnauthorized was always true',
      priority: 'high',
      category: 'security',
      affectedFiles: ['src/dbClient.ts'],
      acceptanceCriteria: 'Non-Railway hosts use rejectUnauthorized: false',
      safetyReason: null,
      builderAgent: 'nvidia',
      status: 'queued',
    });

    const taskFile = path.join(boardroomDir, 'ledger', 'tasks', '011-thatisshayan-costpilot-fix-ssl-config-in-dbclient.md');
    expect(fs.existsSync(taskFile)).toBe(true);
    const content = fs.readFileSync(taskFile, 'utf8');
    expect(content).toMatch(/id: TASK-011/);
    expect(content).toMatch(/status: proposed/); // 'queued' -> 'proposed'
    expect(content).toMatch(/owner: unassigned/);
    expect(content).toMatch(/branch: ""/);
    expect(content).toMatch(/priority: high/);
    expect(content).toMatch(/traces-to: "audit-engine:sentinel"/);
    expect(content).toMatch(/src\/dbClient\.ts/);

    const pool = fs.readFileSync(path.join(boardroomDir, 'ledger', 'pool.md'), 'utf8');
    expect(pool).toMatch(/\| 011 \| \[Sentinel\] Fix SSL config in dbClient \(Thatisshayan\/costpilot\) \| high \| proposed \| unassigned \|/);
    // pre-existing row untouched
    expect(pool).toMatch(/\| 010 \| Existing task \| high \| proposed \| unassigned \|/);

    const map = JSON.parse(fs.readFileSync(path.join(boardroomDir, 'ledger', '.sentinel-task-map.json'), 'utf8'));
    expect(map['42']).toEqual({ ledgerNumber: 11, fileName: '011-thatisshayan-costpilot-fix-ssl-config-in-dbclient.md', repoFullName: 'Thatisshayan/costpilot' });
  });

  it('updates status on both the task file and the pool.md row, appending a progress log line', async () => {
    const { createLedgerTask, updateLedgerTaskStatus } = require('../src/obsidianLedgerWriter');
    await createLedgerTask({
      postgresTaskId: 42,
      repoFullName: 'Thatisshayan/costpilot',
      title: 'Fix SSL config',
      priority: 'high',
      status: 'queued',
    });

    await updateLedgerTaskStatus(42, 'in_progress');

    const taskFile = path.join(boardroomDir, 'ledger', 'tasks', '011-thatisshayan-costpilot-fix-ssl-config.md');
    const content = fs.readFileSync(taskFile, 'utf8');
    expect(content).toMatch(/status: in_progress/);
    expect(content).toMatch(/status -> in_progress\./);

    const pool = fs.readFileSync(path.join(boardroomDir, 'ledger', 'pool.md'), 'utf8');
    expect(pool).toMatch(/\| 011 \|.*\| in_progress \| unassigned \|/);

    await updateLedgerTaskStatus(42, 'build_check', { prUrl: 'https://github.com/x/y/pull/1' });
    const afterReview = fs.readFileSync(taskFile, 'utf8');
    expect(afterReview).toMatch(/status: review/);
    expect(afterReview).toMatch(/PR: https:\/\/github\.com\/x\/y\/pull\/1/);

    await updateLedgerTaskStatus(42, 'done');
    const poolAfterDone = fs.readFileSync(path.join(boardroomDir, 'ledger', 'pool.md'), 'utf8');
    expect(poolAfterDone).not.toMatch(/\| 011 \|/);
    expect(poolAfterDone).toMatch(/DONE: 011, 001-009/);
  });

  it('maps failed and skipped to blocked and cancelled respectively', async () => {
    const { createLedgerTask, updateLedgerTaskStatus } = require('../src/obsidianLedgerWriter');
    await createLedgerTask({ postgresTaskId: 1, repoFullName: 'r', title: 'a', priority: 'low', status: 'queued' });
    await createLedgerTask({ postgresTaskId: 2, repoFullName: 'r', title: 'b', priority: 'low', status: 'queued' });

    await updateLedgerTaskStatus(1, 'failed', { failureReason: 'build broke' });
    await updateLedgerTaskStatus(2, 'skipped');

    const f1 = fs.readFileSync(path.join(boardroomDir, 'ledger', 'tasks', '011-r-a.md'), 'utf8');
    const f2 = fs.readFileSync(path.join(boardroomDir, 'ledger', 'tasks', '012-r-b.md'), 'utf8');
    expect(f1).toMatch(/status: blocked/);
    expect(f1).toMatch(/Reason: build broke/);
    expect(f2).toMatch(/status: cancelled/);
  });

  it('is a silent no-op when the boardroom repo is not available', async () => {
    // IMPORTANT: must NOT simply `delete process.env['OBSIDIAN_BOARDROOM_PATH']`
    // here — resolveBoardroomPath()'s fallback is a real sibling-directory
    // path, which genuinely exists on a dev machine that has the actual
    // OBSIDIAN-TEAM-BOARDROOM repo checked out next to project-sentinel.
    // An earlier version of this test did exactly that and it silently wrote
    // real files into the real boardroom repo during a real test run.
    // Point at a path that is guaranteed not to exist instead.
    process.env['OBSIDIAN_BOARDROOM_PATH'] = path.join(os.tmpdir(), `obsidian-writer-definitely-missing-${Date.now()}`);
    cleanup(boardroomDir);
    jest.resetModules();
    const { createLedgerTask, updateLedgerTaskStatus } = require('../src/obsidianLedgerWriter');

    await expect(createLedgerTask({
      postgresTaskId: 1, repoFullName: 'r', title: 't', priority: 'low', status: 'queued',
    })).resolves.toBeUndefined();
    await expect(updateLedgerTaskStatus(1, 'done')).resolves.toBeUndefined();
  });

  it('never throws even when the boardroom path exists but pool.md is missing', async () => {
    fs.rmSync(path.join(boardroomDir, 'ledger', 'pool.md'));
    const { createLedgerTask } = require('../src/obsidianLedgerWriter');
    await expect(createLedgerTask({
      postgresTaskId: 99, repoFullName: 'r', title: 't', priority: 'low', status: 'queued',
    })).resolves.toBeUndefined();
    const taskFile = path.join(boardroomDir, 'ledger', 'tasks', '011-r-t.md');
    expect(fs.existsSync(taskFile)).toBe(true);
  });
});

describe('obsidianLedgerWriter push mode (OBSIDIAN_BOARDROOM_WRITE_TOKEN set)', () => {
  let originalToken: string | undefined;
  let originalPath: string | undefined;
  let clonedInto: string | undefined;
  let capturedTaskFile: string | undefined;
  const gitCalls: { add: unknown[]; commit: unknown[]; push: unknown[] } = { add: [], commit: [], push: [] };

  beforeEach(() => {
    originalToken = process.env['OBSIDIAN_BOARDROOM_WRITE_TOKEN'];
    originalPath = process.env['OBSIDIAN_BOARDROOM_PATH'];
    process.env['OBSIDIAN_BOARDROOM_WRITE_TOKEN'] = 'fake-write-token';
    // Push mode ignores OBSIDIAN_BOARDROOM_PATH entirely (it always clones
    // fresh) - unset it so a stray real sibling checkout can't leak in.
    delete process.env['OBSIDIAN_BOARDROOM_PATH'];
    clonedInto = undefined;
    capturedTaskFile = undefined;
    gitCalls.add = [];
    gitCalls.commit = [];
    gitCalls.push = [];
    jest.resetModules();

    jest.doMock('simple-git', () => {
      return jest.fn((cwd?: string) => {
        if (cwd === undefined) {
          // simpleGit() with no args is only ever used for .clone() here.
          return {
            clone: jest.fn(async (_url: string, dir: string) => {
              clonedInto = dir;
              fs.mkdirSync(path.join(dir, 'ledger', 'tasks'), { recursive: true });
              fs.writeFileSync(path.join(dir, 'ledger', 'pool.md'), POOL_FIXTURE, 'utf8');
            }),
          };
        }
        return {
          addConfig: jest.fn(async () => undefined),
          // Captured here, not after createLedgerTask() returns: the temp
          // clone is deleted inside the same call, right after the push,
          // so anything we want to verify about on-disk content has to be
          // read at add-time, while the clone still exists.
          add: jest.fn(async (paths: unknown) => {
            gitCalls.add.push(paths);
            capturedTaskFile = fs.existsSync(path.join(cwd, 'ledger', 'tasks', '001-r-push-mode-task.md'))
              ? fs.readFileSync(path.join(cwd, 'ledger', 'tasks', '001-r-push-mode-task.md'), 'utf8')
              : undefined;
          }),
          status: jest.fn(async () => ({ staged: ['ledger/pool.md'] })),
          commit: jest.fn(async (message: unknown) => { gitCalls.commit.push(message); }),
          push: jest.fn(async (...args: unknown[]) => { gitCalls.push.push(args); }),
        };
      });
    });
  });

  afterEach(() => {
    if (clonedInto && fs.existsSync(clonedInto)) cleanup(clonedInto);
    if (originalToken === undefined) delete process.env['OBSIDIAN_BOARDROOM_WRITE_TOKEN'];
    else process.env['OBSIDIAN_BOARDROOM_WRITE_TOKEN'] = originalToken;
    if (originalPath === undefined) delete process.env['OBSIDIAN_BOARDROOM_PATH'];
    else process.env['OBSIDIAN_BOARDROOM_PATH'] = originalPath;
    jest.dontMock('simple-git');
  });

  it('clones fresh, writes the ledger files, then commits and pushes directly to master', async () => {
    const { createLedgerTask } = require('../src/obsidianLedgerWriter');
    await createLedgerTask({
      postgresTaskId: 1, repoFullName: 'r', title: 'Push mode task', priority: 'high', status: 'queued',
    });

    expect(clonedInto).toBeDefined();
    expect(capturedTaskFile).toBeDefined();
    expect(capturedTaskFile).toMatch(/id: TASK-001/);
    expect(capturedTaskFile).toMatch(/priority: high/);

    expect(gitCalls.add).toHaveLength(1);
    // Narrow, explicit paths only - never a blanket add-everything.
    expect(gitCalls.add[0]).toEqual([
      path.join('ledger', 'tasks'),
      path.join('ledger', 'pool.md'),
      path.join('ledger', '.sentinel-task-map.json'),
    ]);
    expect(gitCalls.commit).toHaveLength(1);
    expect(gitCalls.commit[0]).toMatch(/automated/i);
    expect(gitCalls.push).toHaveLength(1);
    expect(gitCalls.push[0]).toEqual(['origin', 'master']);
  });

  it('skips commit and push when nothing actually changed (idempotent re-run)', async () => {
    jest.doMock('simple-git', () => {
      return jest.fn((cwd?: string) => {
        if (cwd === undefined) {
          return {
            clone: jest.fn(async (_url: string, dir: string) => {
              clonedInto = dir;
              fs.mkdirSync(path.join(dir, 'ledger', 'tasks'), { recursive: true });
              fs.writeFileSync(path.join(dir, 'ledger', 'pool.md'), POOL_FIXTURE, 'utf8');
            }),
          };
        }
        return {
          addConfig: jest.fn(async () => undefined),
          add: jest.fn(async (paths: unknown) => { gitCalls.add.push(paths); }),
          status: jest.fn(async () => ({ staged: [] })), // nothing staged
          commit: jest.fn(async (message: unknown) => { gitCalls.commit.push(message); }),
          push: jest.fn(async (...args: unknown[]) => { gitCalls.push.push(args); }),
        };
      });
    });
    const { createLedgerTask } = require('../src/obsidianLedgerWriter');
    await createLedgerTask({ postgresTaskId: 1, repoFullName: 'r', title: 't', priority: 'low', status: 'queued' });

    expect(gitCalls.commit).toHaveLength(0);
    expect(gitCalls.push).toHaveLength(0);
  });

  it('cleans up the temp clone directory even when the push itself fails', async () => {
    jest.doMock('simple-git', () => {
      return jest.fn((cwd?: string) => {
        if (cwd === undefined) {
          return {
            clone: jest.fn(async (_url: string, dir: string) => {
              clonedInto = dir;
              fs.mkdirSync(path.join(dir, 'ledger', 'tasks'), { recursive: true });
              fs.writeFileSync(path.join(dir, 'ledger', 'pool.md'), POOL_FIXTURE, 'utf8');
            }),
          };
        }
        return {
          addConfig: jest.fn(async () => undefined),
          add: jest.fn(async () => undefined),
          status: jest.fn(async () => ({ staged: ['ledger/pool.md'] })),
          commit: jest.fn(async () => undefined),
          push: jest.fn(async () => { throw new Error('non-fast-forward, remote changed'); }),
        };
      });
    });
    const { createLedgerTask } = require('../src/obsidianLedgerWriter');
    // The outer try/catch in createLedgerTask makes this a non-blocking,
    // logged failure rather than a thrown rejection - matches the existing
    // "never throws" contract for every other failure mode in this module.
    await expect(createLedgerTask({
      postgresTaskId: 1, repoFullName: 'r', title: 't', priority: 'low', status: 'queued',
    })).resolves.toBeUndefined();
    expect(fs.existsSync(clonedInto!)).toBe(false);
  });
});
