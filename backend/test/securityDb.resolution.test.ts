const queryMock = jest.fn();
jest.mock('../src/dbClient', () => ({ query: (...a: any[]) => queryMock(...a) }));

import { markIssuesPatchPending, resolveIssuesByPr, resolveAllOpenIssues } from '../src/securityDb';

describe('securityDb resolution lifecycle', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  describe('markIssuesPatchPending', () => {
    it('does nothing (no query) when there are no issue ids', async () => {
      await markIssuesPatchPending([], 'https://github.com/org/repo/pull/1', 'sentinel/security-patch-1');
      expect(queryMock).not.toHaveBeenCalled();
    });

    it('updates matching open issues to patch_pending with the pr_url/branch_name, scoped to id array + open status', async () => {
      queryMock.mockResolvedValue({ rows: [] });
      await markIssuesPatchPending([5, 9], 'https://github.com/org/repo/pull/1', 'sentinel/security-patch-1');

      expect(queryMock).toHaveBeenCalledTimes(1);
      const [sql, params] = queryMock.mock.calls[0];
      expect(sql).toContain("SET status = 'patch_pending'");
      expect(sql).toContain('id = ANY($1::int[])');
      expect(sql).toContain("AND status = 'open'");
      expect(params).toEqual([[5, 9], 'https://github.com/org/repo/pull/1', 'sentinel/security-patch-1']);
    });
  });

  describe('resolveIssuesByPr', () => {
    it('marks issues resolved for the given repo + pr_url and returns the count', async () => {
      queryMock.mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }] });
      const count = await resolveIssuesByPr('org/repo', 'https://github.com/org/repo/pull/7');

      expect(count).toBe(2);
      const [sql, params] = queryMock.mock.calls[0];
      expect(sql).toContain("SET status = 'resolved'");
      expect(sql).toContain('resolved_at = NOW()');
      expect(sql).toContain('repo_full_name = $1 AND pr_url = $2');
      expect(params).toEqual(['org/repo', 'https://github.com/org/repo/pull/7']);
    });

    it('returns 0 when nothing matches', async () => {
      queryMock.mockResolvedValue({ rows: [] });
      const count = await resolveIssuesByPr('org/repo', 'https://github.com/org/repo/pull/999');
      expect(count).toBe(0);
    });
  });

  describe('resolveAllOpenIssues', () => {
    it('marks all open issues for a repo resolved and returns the count', async () => {
      queryMock.mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }, { id: 3 }] });
      const count = await resolveAllOpenIssues('org/repo');

      expect(count).toBe(3);
      const [sql, params] = queryMock.mock.calls[0];
      expect(sql).toContain("SET status = 'resolved'");
      expect(sql).toContain("WHERE repo_full_name = $1 AND status = 'open'");
      expect(params).toEqual(['org/repo']);
    });
  });
});
