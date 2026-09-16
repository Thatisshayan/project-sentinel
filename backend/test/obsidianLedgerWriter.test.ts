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
