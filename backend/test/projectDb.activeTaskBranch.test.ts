jest.mock('../src/dbClient', () => ({
  query: jest.fn(),
}));

import projectDb from '../src/projectDb';
import { query } from '../src/dbClient';

const {
  getActiveTaskBranch,
  setActiveTaskBranch,
  clearActiveTaskBranch,
  getRepoAutomationPolicy,
  setRepoAutomationPolicy,
  getRepoPolicyAuditLog,
} = projectDb;

describe('projectDb — active task branch (D-027 item 3: same-PR patch loop)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('getActiveTaskBranch returns null when no row exists', async () => {
    (query as jest.Mock).mockResolvedValue({ rows: [] });
    const result = await getActiveTaskBranch('tapcash');
    expect(result).toBeNull();
  });

  test('getActiveTaskBranch returns null when the row has no active branch set', async () => {
    (query as jest.Mock).mockResolvedValue({
      rows: [{ repo_name: 'tapcash', active_task_branch: null, active_pr_url: null, active_pr_number: null }],
    });
    const result = await getActiveTaskBranch('tapcash');
    expect(result).toBeNull();
  });

  test('getActiveTaskBranch returns the branch/PR when set', async () => {
    (query as jest.Mock).mockResolvedValue({
      rows: [{
        repo_name: 'tapcash', active_task_branch: 'sentinel/work-123',
        active_pr_url: 'https://github.com/org/tapcash/pull/5', active_pr_number: 5,
      }],
    });
    const result = await getActiveTaskBranch('tapcash');
    expect(result).toEqual({
      branch: 'sentinel/work-123',
      prUrl: 'https://github.com/org/tapcash/pull/5',
      prNumber: 5,
    });
  });

  test('getActiveTaskBranch refuses a toId()-collided row belonging to a different repo', async () => {
    // 'my-app' and 'my_app' both collapse to the same id via toId().
    (query as jest.Mock).mockResolvedValue({
      rows: [{ repo_name: 'my_app', active_task_branch: 'sentinel/work-1', active_pr_url: null, active_pr_number: null }],
    });
    const result = await getActiveTaskBranch('my-app');
    expect(result).toBeNull();
  });

  test('setActiveTaskBranch upserts with the branch/PR and repo_name guard', async () => {
    (query as jest.Mock).mockResolvedValue({ rows: [] });
    await setActiveTaskBranch('tapcash', 'sentinel/work-123', 'https://github.com/org/tapcash/pull/5', 5);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = (query as jest.Mock).mock.calls[0];
    expect(sql).toContain('ON CONFLICT (id) DO UPDATE');
    expect(sql).toContain('WHERE projects.repo_name = $2');
    expect(params).toEqual(['tapcash', 'tapcash', 'sentinel/work-123', 'https://github.com/org/tapcash/pull/5', 5]);
  });

  test('clearActiveTaskBranch nulls out branch/PR fields, guarded on id AND repo_name', async () => {
    (query as jest.Mock).mockResolvedValue({ rows: [] });
    await clearActiveTaskBranch('tapcash');

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = (query as jest.Mock).mock.calls[0];
    expect(sql).toContain('active_task_branch = NULL');
    expect(sql).toContain('active_pr_url = NULL');
    expect(sql).toContain('active_pr_number = NULL');
    expect(sql).toContain('WHERE id = $1 AND repo_name = $2');
    expect(params).toEqual(['tapcash', 'tapcash']);
  });

  test('getRepoAutomationPolicy returns defaults when no row exists', async () => {
    (query as jest.Mock).mockResolvedValue({ rows: [] });

    const result = await getRepoAutomationPolicy('tapcash');

    expect(result).toEqual({
      preset: 'full-auto',
      policy: {
        allowTaskExecution: true,
        allowPrOpen: true,
        allowPrUpdate: true,
        allowAutoPush: true,
      },
    });
  });

  test('getRepoAutomationPolicy returns stored policy when present', async () => {
    (query as jest.Mock).mockResolvedValue({
      rows: [{
        repo_name: 'tapcash',
        repo_policy_preset: 'custom',
        allow_task_execution: false,
        allow_pr_open: true,
        allow_pr_update: false,
        allow_auto_push: true,
      }],
    });

    const result = await getRepoAutomationPolicy('tapcash');

    expect(result).toEqual({
      preset: 'custom',
      policy: {
        allowTaskExecution: false,
        allowPrOpen: true,
        allowPrUpdate: false,
        allowAutoPush: true,
      },
    });
  });

  test('setRepoAutomationPolicy upserts the policy fields, preset, and audit entry with the repo_name guard', async () => {
    (query as jest.Mock)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await setRepoAutomationPolicy('tapcash', {
      policy: {
        allowTaskExecution: false,
        allowPrOpen: true,
        allowPrUpdate: false,
        allowAutoPush: true,
      },
      changedBy: 'Dashboard',
    });

    expect(query).toHaveBeenCalledTimes(3);
    const [sql, params] = (query as jest.Mock).mock.calls[0];
    expect(sql).toContain('SELECT repo_name, repo_policy_preset');
    expect(params).toEqual(['tapcash']);

    const [upsertSql, upsertParams] = (query as jest.Mock).mock.calls[1];
    expect(upsertSql).toContain('repo_policy_preset');
    expect(upsertSql).toContain('allow_task_execution');
    expect(upsertSql).toContain('allow_pr_open');
    expect(upsertSql).toContain('allow_pr_update');
    expect(upsertSql).toContain('allow_auto_push');
    expect(upsertSql).toContain('WHERE projects.repo_name = $2');
    expect(upsertParams).toEqual(['tapcash', 'tapcash', 'custom', false, true, false, true]);

    const [auditSql, auditParams] = (query as jest.Mock).mock.calls[2];
    expect(auditSql).toContain('INSERT INTO repo_policy_audit_log');
    expect(auditParams[0]).toBe('tapcash');
    expect(auditParams[1]).toBe('Dashboard');
    expect(auditParams[2]).toBe('full-auto');
    expect(auditParams[3]).toBe('custom');
  });

  test('setRepoAutomationPolicy does not write an audit entry for a no-op update', async () => {
    (query as jest.Mock)
      .mockResolvedValueOnce({
        rows: [{
          repo_name: 'tapcash',
          repo_policy_preset: 'full-auto',
          allow_task_execution: true,
          allow_pr_open: true,
          allow_pr_update: true,
          allow_auto_push: true,
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    await setRepoAutomationPolicy('tapcash', {
      preset: 'full-auto',
      changedBy: 'Dashboard',
    });

    expect(query).toHaveBeenCalledTimes(2);
    const [upsertSql] = (query as jest.Mock).mock.calls[1];
    expect(upsertSql).toContain('repo_policy_preset');
  });

  test('getRepoPolicyAuditLog normalizes stored audit entries', async () => {
    (query as jest.Mock).mockResolvedValue({
      rows: [{
        id: 7,
        repo_name: 'tapcash',
        changed_by: 'Dashboard',
        preset_before: 'full-auto',
        preset_after: 'audit-only',
        policy_before: {
          allowTaskExecution: true,
          allowPrOpen: true,
          allowPrUpdate: true,
          allowAutoPush: true,
        },
        policy_after: {
          allowTaskExecution: false,
          allowPrOpen: false,
          allowPrUpdate: false,
          allowAutoPush: false,
        },
        changed_at: '2026-08-22T12:00:00.000Z',
      }],
    });

    const result = await getRepoPolicyAuditLog('tapcash', 10);

    expect(query).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{
      id: 7,
      repoName: 'tapcash',
      changedBy: 'Dashboard',
      presetBefore: 'full-auto',
      presetAfter: 'audit-only',
      policyBefore: {
        allowTaskExecution: true,
        allowPrOpen: true,
        allowPrUpdate: true,
        allowAutoPush: true,
      },
      policyAfter: {
        allowTaskExecution: false,
        allowPrOpen: false,
        allowPrUpdate: false,
        allowAutoPush: false,
      },
      changedAt: '2026-08-22T12:00:00.000Z',
    }]);
  });
});
