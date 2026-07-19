jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({ on: jest.fn(), query: jest.fn() })),
}));

const queryMock = jest.fn();

/**
 * Regression guard: updateDebugAttempt used to build its SET clause
 * straight from Object.keys(updates) with no allowlist — safe only by
 * accident since every real call site passes hardcoded literal keys. The
 * next caller that ever passed a dynamic/user-influenced key would have
 * been a SQL-injection point via the column identifier itself (column
 * names can't be parameterized the way values can).
 */
describe('dbClient.updateDebugAttempt', () => {
  let updateDebugAttempt: any;

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
    updateDebugAttempt = require('../src/dbClient').updateDebugAttempt;
  });

  it('updates allowlisted columns normally', async () => {
    queryMock.mockResolvedValue({ rows: [{ id: 1, status: 'fix_pending' }] });

    const result = await updateDebugAttempt('org/repo', 'sha123', {
      status: 'fix_pending', fix_pr_url: 'https://github.com/org/repo/pull/5',
    });

    expect(result).toEqual({ id: 1, status: 'fix_pending' });
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('status = $3');
    expect(sql).toContain('fix_pr_url = $4');
    expect(params).toEqual(['org/repo', 'sha123', 'fix_pending', 'https://github.com/org/repo/pull/5']);
  });

  it('drops a non-allowlisted column instead of interpolating it into the SQL', async () => {
    queryMock.mockResolvedValue({ rows: [{ id: 1, status: 'fix_pending' }] });

    await updateDebugAttempt('org/repo', 'sha123', {
      status: 'fix_pending',
      // Not a real debug_attempts column — simulates an injection-shaped key.
      'id); DROP TABLE debug_attempts; --': 'x',
    });

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).toContain('status = $3');
    expect(params).toEqual(['org/repo', 'sha123', 'fix_pending']);
  });

  it('does not query at all when every provided key is rejected', async () => {
    const result = await updateDebugAttempt('org/repo', 'sha123', {
      not_a_real_column: 'x',
    });

    expect(queryMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
