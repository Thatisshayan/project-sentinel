const axiosGetMock = jest.fn();
const axiosPostMock = jest.fn();
jest.mock('axios', () => ({
  get: (...a: any[]) => axiosGetMock(...a),
  post: (...a: any[]) => axiosPostMock(...a),
}));

const getDefaultBranchMock = jest.fn();
jest.mock('../src/repoDiscovery', () => ({ getDefaultBranch: (...a: any[]) => getDefaultBranchMock(...a) }));

// auditOrchestrator.ts pulls in a lot of dependencies transitively (dbClient,
// telegramClient, etc.) — none of them are exercised by postAuditSummaryToGithub
// itself, but they still need to resolve without throwing at import time.
jest.mock('../src/claudeCodeAudit', () => ({ runAudit: jest.fn() }));
jest.mock('../src/auditTaskWriter', () => ({ writeTasksToNotion: jest.fn(), updateNotionTaskStatus: jest.fn() }));
jest.mock('../src/taskBuilder', () => ({ executeBatch: jest.fn() }));
jest.mock('../src/prCreator', () => ({ createPullRequest: jest.fn() }));
jest.mock('../src/telegramClient', () => ({ sendTelegramMessage: jest.fn() }));
jest.mock('../src/slackClient', () => ({ sendSlackButtons: jest.fn() }));
jest.mock('../src/notionClient', () => ({ findNotionProject: jest.fn() }));
jest.mock('../src/auditDb', () => ({
  createAuditCycle: jest.fn(), updateAuditCycle: jest.fn(), getActiveCycleForRepo: jest.fn(),
  getLastCompletedAudit: jest.fn(), getPreviousHealthScore: jest.fn(), getQueuedTaskCount: jest.fn(),
  getNextBatch: jest.fn(), updateAuditTask: jest.fn(), countTasksExecutedToday: jest.fn(),
  stopAllTasksForRepo: jest.fn(), markTasksDoneForBranch: jest.fn(),
}));
jest.mock('../src/selfHealer', () => ({ reportFailure: jest.fn(), reportSuccess: jest.fn() }));
jest.mock('../src/performanceTracker', () => ({ trackModelCall: jest.fn() }));
jest.mock('../src/repoLock', () => ({ isRepoLocked: jest.fn() }));
jest.mock('../src/settingsLoader', () => ({ loadSettings: jest.fn().mockResolvedValue({ audit_cooldown_h: 12 }) }));
jest.mock('../src/dbClient', () => ({ query: jest.fn() }));
jest.mock('../src/queueClient', () => ({ enqueueScheduledJob: jest.fn() }));
jest.mock('../src/workers/scheduledJobsWorker', () => ({ AUDIT_APPROVAL_TIMEOUT_JOB: 'audit-approval-timeout' }));

import { postAuditSummaryToGithub } from '../src/auditOrchestrator';

describe('auditOrchestrator — postAuditSummaryToGithub', () => {
  const ORIGINAL_ENV = process.env;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, GITHUB_TOKEN: 'test-gh-token' };
  });
  afterAll(() => { process.env = ORIGINAL_ENV; });

  it('is a no-op when GITHUB_TOKEN is not configured', async () => {
    delete process.env['GITHUB_TOKEN'];
    await postAuditSummaryToGithub('org/repo', 'main', 'summary text');
    expect(axiosGetMock).not.toHaveBeenCalled();
    expect(axiosPostMock).not.toHaveBeenCalled();
  });

  it('resolves the real latest commit on the given branch and posts a comment on it', async () => {
    axiosGetMock.mockResolvedValue({ data: { sha: 'abc123' } });
    axiosPostMock.mockResolvedValue({ data: {} });

    await postAuditSummaryToGithub('org/repo', 'main', 'audit summary here');

    expect(axiosGetMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/org/repo/commits/main',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-gh-token' }) })
    );
    expect(axiosPostMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/org/repo/commits/abc123/comments',
      { body: 'audit summary here' },
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-gh-token' }) })
    );
    expect(getDefaultBranchMock).not.toHaveBeenCalled();
  });

  it('falls back to the repo default branch when no branchName is given (manual/ad-hoc audits)', async () => {
    getDefaultBranchMock.mockResolvedValue('develop');
    axiosGetMock.mockResolvedValue({ data: { sha: 'def456' } });
    axiosPostMock.mockResolvedValue({ data: {} });

    await postAuditSummaryToGithub('org/repo', undefined, 'summary');

    expect(getDefaultBranchMock).toHaveBeenCalledWith('org/repo');
    expect(axiosGetMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/org/repo/commits/develop',
      expect.anything()
    );
  });

  it('does not throw (and does not post) when resolving the commit sha fails', async () => {
    axiosGetMock.mockRejectedValue(new Error('GitHub API down'));
    await expect(postAuditSummaryToGithub('org/repo', 'main', 'summary')).resolves.toBeUndefined();
    expect(axiosPostMock).not.toHaveBeenCalled();
  });

  it('does not throw when no sha is present in the response', async () => {
    axiosGetMock.mockResolvedValue({ data: {} });
    await expect(postAuditSummaryToGithub('org/repo', 'main', 'summary')).resolves.toBeUndefined();
    expect(axiosPostMock).not.toHaveBeenCalled();
  });

  it('does not throw when the comment post itself fails', async () => {
    axiosGetMock.mockResolvedValue({ data: { sha: 'abc123' } });
    axiosPostMock.mockRejectedValue(new Error('rate limited'));
    await expect(postAuditSummaryToGithub('org/repo', 'main', 'summary')).resolves.toBeUndefined();
  });

  it('truncates an oversized body rather than sending it unbounded', async () => {
    axiosGetMock.mockResolvedValue({ data: { sha: 'abc123' } });
    axiosPostMock.mockResolvedValue({ data: {} });
    const huge = 'x'.repeat(70000);

    await postAuditSummaryToGithub('org/repo', 'main', huge);

    const postedBody = axiosPostMock.mock.calls[0][1].body;
    expect(postedBody.length).toBeLessThan(70000);
    expect(postedBody).toContain('[truncated]');
  });
});
