jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({ on: jest.fn(), query: jest.fn() })),
}));

const queryMock = jest.fn();

describe('dbClient.resolveDebugAttemptByPr', () => {
  let resolveDebugAttemptByPr: any;

  beforeEach(() => {
    jest.resetModules();
    queryMock.mockReset();
    jest.doMock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        query: (...a: any[]) => queryMock(...a),
      })),
    }));
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    resolveDebugAttemptByPr = require('../src/dbClient').resolveDebugAttemptByPr;
  });

  it('updates a fix_pending debug attempt to resolved, scoped by repo + fix_pr_url + fix_pending status', async () => {
    queryMock.mockResolvedValue({ rows: [{ id: 1, status: 'resolved' }] });
    const result = await resolveDebugAttemptByPr('org/repo', 'https://github.com/org/repo/pull/5');

    expect(result).toEqual({ id: 1, status: 'resolved' });
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("SET status = 'resolved'");
    expect(sql).toContain('repo_full_name = $1 AND fix_pr_url = $2');
    expect(sql).toContain("AND status = 'fix_pending'");
    expect(params).toEqual(['org/repo', 'https://github.com/org/repo/pull/5']);
  });

  it('returns null when no matching fix_pending row exists', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const result = await resolveDebugAttemptByPr('org/repo', 'https://github.com/org/repo/pull/999');
    expect(result).toBeNull();
  });
});
