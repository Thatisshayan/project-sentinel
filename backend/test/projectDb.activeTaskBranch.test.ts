jest.mock('../src/dbClient', () => ({
  query: jest.fn(),
}));

import projectDb from '../src/projectDb';
import { query } from '../src/dbClient';

const { getActiveTaskBranch, setActiveTaskBranch, clearActiveTaskBranch } = projectDb;

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
});
