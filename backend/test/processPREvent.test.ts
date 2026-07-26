jest.mock('../src/dbClient', () => ({
  query: jest.fn(),
  resolveDebugAttemptByPr: jest.fn(),
}));

jest.mock('../src/securityDb', () => ({
  resolveIssuesByPr: jest.fn().mockResolvedValue(0),
}));

jest.mock('../src/auditTaskWriter', () => ({
  updateNotionTaskStatus: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/telegramClient', () => ({
  sendTelegramMessage: jest.fn().mockResolvedValue(true),
}));

// Passthrough safeFire — resolves/rejects exactly like the passed promise,
// without invoking logger or Sentry. Keeps processPREvent's call shape
// intact so we can assert on what it fires.
jest.mock('../src/utils/safeFire', () => ({
  safeFire: (p: any) => (typeof p === 'function' ? p() : p),
  fireAndForget: (_p: any) => undefined,
}));

import { processPREvent } from '../src/webhook/processPREvent';
import { query, resolveDebugAttemptByPr } from '../src/dbClient';
import { resolveIssuesByPr } from '../src/securityDb';
import { updateNotionTaskStatus } from '../src/auditTaskWriter';
import { sendTelegramMessage } from '../src/telegramClient';

describe('processPREvent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (query as jest.Mock).mockResolvedValue({ rows: [] });
    (resolveDebugAttemptByPr as jest.Mock).mockResolvedValue(null);
    (resolveIssuesByPr as jest.Mock).mockResolvedValue(0);
    (updateNotionTaskStatus as jest.Mock).mockResolvedValue(undefined);
    (sendTelegramMessage as jest.Mock).mockResolvedValue(true);
  });

  const basePR = {
    number: 99,
    merged: true,
    html_url: 'https://github.com/your-org/tapcash/pull/99',
    head: { ref: 'sentinel/batch-1-tasks-1-5' },
    base: { ref: 'main' },
  };
  const baseRepo = { name: 'tapcash', full_name: 'your-org/tapcash' };

  function build(action = 'closed', prOverrides: any = {}, repoOverrides: any = {}) {
    return {
      action,
      pull_request: { ...basePR, ...prOverrides },
      repository: { ...baseRepo, ...repoOverrides },
    };
  }

  test('merged PR: marks done the task whose pr_url matches and calls updateNotionTaskStatus for each returned row', async () => {
    (query as jest.Mock).mockResolvedValue({
      rows: [{ id: 1, notion_page_id: 'page-abc' }],
    });

    await processPREvent(build());

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = (query as jest.Mock).mock.calls[0];
    expect(sql).toContain("status = 'done'");
    expect(sql).toContain('pr_url = $2 OR (pr_url IS NULL AND pr_number = $3)');
    expect(params).toEqual(['your-org/tapcash', 'https://github.com/your-org/tapcash/pull/99', 99]);

    expect(updateNotionTaskStatus).toHaveBeenCalledTimes(1);
    expect(updateNotionTaskStatus).toHaveBeenCalledWith('page-abc', 'done', {
      prUrl: 'https://github.com/your-org/tapcash/pull/99',
    });
  });

  test('M-1 regression: the SQL WHERE clause prefers pr_url match and falls back to pr_number ONLY when pr_url IS NULL', async () => {
    (query as jest.Mock).mockResolvedValue({ rows: [] });

    await processPREvent(build());

    const sql = (query as jest.Mock).mock.calls[0][0];
    // The corrected clause shape — must NOT be the buggy `OR pr_number = $3`
    // alone, which would match a row with a stale pr_number even when its
    // pr_url is set to a different PR.
    expect(sql).toContain('(pr_url = $2 OR (pr_url IS NULL AND pr_number = $3))');
    expect(sql).not.toMatch(/pr_url = \$2 OR pr_number = \$3/);
  });

  test('M-1 regression: a task whose pr_number is 99 but pr_url is set (to a different PR) is NOT marked done — only the pr_url-matching row is returned', async () => {
    // The mock DB returns exactly one row — the one whose pr_url matched —
    // proving the corrected WHERE narrows to the right task. We assert
    // that updateNotionTaskStatus runs exactly once on that single row.
    (query as jest.Mock).mockResolvedValue({
      rows: [{ id: 7, notion_page_id: 'page-7' }],
    });

    await processPREvent(build());

    expect(query).toHaveBeenCalledTimes(1);
    expect(updateNotionTaskStatus).toHaveBeenCalledTimes(1);
    expect(updateNotionTaskStatus).toHaveBeenCalledWith('page-7', 'done', expect.anything());
  });

  test('rejected PR: requeues only matching tasks with status = queued and clears pr_url/pr_number', async () => {
    (query as jest.Mock).mockResolvedValue({ rows: [{ id: 1 }] });

    await processPREvent(build('closed', { merged: false }));

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = (query as jest.Mock).mock.calls[0];
    expect(sql).toContain("status = 'queued'");
    expect(sql).toContain('pr_url = NULL');
    expect(sql).toContain('pr_number = NULL');
    expect(sql).toContain('(pr_url = $2 OR (pr_url IS NULL AND pr_number = $3))');
    expect(params).toEqual(['your-org/tapcash', 'https://github.com/your-org/tapcash/pull/99', 99]);
  });

  test('returns early without a DB write for a non-sentinel branch', async () => {
    await processPREvent(build('closed', { head: { ref: 'feature/dark-mode' } }));
    expect(query).not.toHaveBeenCalled();
  });

  test('returns early without a DB write for a non-closed action', async () => {
    await processPREvent(build('opened'));
    expect(query).not.toHaveBeenCalled();
  });

  test('returns early when pull_request is missing', async () => {
    await processPREvent({ action: 'closed', repository: baseRepo });
    expect(query).not.toHaveBeenCalled();
  });

  test('returns early when repository is missing', async () => {
    await processPREvent({ action: 'closed', pull_request: basePR });
    expect(query).not.toHaveBeenCalled();
  });

  test('merged security-patch branch calls resolveIssuesByPr', async () => {
    (query as jest.Mock).mockResolvedValue({ rows: [] });

    await processPREvent(
      build('closed', {
        head: { ref: 'sentinel/security-patch-1234567890' },
        html_url: 'https://github.com/your-org/tapcash/pull/77',
      })
    );

    expect(resolveIssuesByPr).toHaveBeenCalledWith(
      'your-org/tapcash',
      'https://github.com/your-org/tapcash/pull/77'
    );
  });

  test('merged fix- branch calls resolveDebugAttemptByPr', async () => {
    (resolveDebugAttemptByPr as jest.Mock).mockResolvedValue({ id: 5, status: 'resolved' });
    (query as jest.Mock).mockResolvedValue({ rows: [] });

    await processPREvent(
      build('closed', {
        head: { ref: 'sentinel/fix-1-1234567890' },
        html_url: 'https://github.com/your-org/tapcash/pull/100',
      })
    );

    expect(resolveDebugAttemptByPr).toHaveBeenCalledWith(
      'your-org/tapcash',
      'https://github.com/your-org/tapcash/pull/100'
    );
  });

  test('does NOT call resolveIssuesByPr for a non-security-patch sentinel branch', async () => {
    await processPREvent(build());
    expect(resolveIssuesByPr).not.toHaveBeenCalled();
  });

  test('does NOT call resolveDebugAttemptByPr for a non-fix sentinel branch', async () => {
    await processPREvent(build());
    expect(resolveDebugAttemptByPr).not.toHaveBeenCalled();
  });

  test('rejected security-patch PR does NOT call resolveIssuesByPr (only merge triggers resolution)', async () => {
    await processPREvent(
      build('closed', { merged: false, head: { ref: 'sentinel/security-patch-1234567890' } })
    );
    expect(resolveIssuesByPr).not.toHaveBeenCalled();
  });

  test('query error is swallowed (catch returns null) — does not throw, does not call updateNotionTaskStatus', async () => {
    (query as jest.Mock).mockRejectedValue(new Error('db down'));

    await expect(processPREvent(build())).resolves.toBeUndefined();
    expect(updateNotionTaskStatus).not.toHaveBeenCalled();
  });

  test('merged PR sends a Telegram "PR Merged" message', async () => {
    (query as jest.Mock).mockResolvedValue({ rows: [{ id: 1, notion_page_id: 'page-abc' }] });

    await processPREvent(build());

    expect(sendTelegramMessage).toHaveBeenCalled();
    const lastCall = (sendTelegramMessage as jest.Mock).mock.calls.slice(-1)[0];
    expect(lastCall[0]).toContain('PR Merged');
    expect(lastCall[0]).toContain('#99');
  });

  test('rejected PR sends a Telegram "PR Rejected" message', async () => {
    (query as jest.Mock).mockResolvedValue({ rows: [{ id: 1 }] });

    await processPREvent(build('closed', { merged: false }));

    expect(sendTelegramMessage).toHaveBeenCalled();
    const lastCall = (sendTelegramMessage as jest.Mock).mock.calls.slice(-1)[0];
    expect(lastCall[0]).toContain('PR Rejected');
  });
});
