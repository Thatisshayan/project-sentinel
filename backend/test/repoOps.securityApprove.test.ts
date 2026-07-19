const sendTelegramMessageMock  = jest.fn().mockResolvedValue(undefined);
const resolveAllOpenIssuesMock = jest.fn();

jest.mock('../src/telegramClient', () => ({
  sendTelegramMessage: (...a: any[]) => sendTelegramMessageMock(...a),
}));

jest.mock('../src/securityDb', () => ({
  resolveAllOpenIssues: (...a: any[]) => resolveAllOpenIssuesMock(...a),
}));

jest.mock('../src/dbClient', () => ({
  stopDebugAttempts: jest.fn(),
  query: jest.fn(),
}));

jest.mock('../src/repoResolver', () => ({
  repoFullName: (name: string) => `your-org/${name}`,
  canonicalizeRepoName: (name: string) => ({ repoName: name }),
}));

jest.mock('../src/auditOrchestrator', () => ({
  executeApprovedTasks: jest.fn(), triggerAudit: jest.fn(), processNextBatch: jest.fn(),
}));
jest.mock('../src/auditDb', () => ({ stopAllTasksForRepo: jest.fn(), updateAuditTask: jest.fn() }));
jest.mock('../src/agentDb', () => ({ getAllAgents: jest.fn() }));
jest.mock('../src/notionClient', () => ({ findNotionProject: jest.fn() }));

import { handleRepoOpsCmd } from '../src/commands/repoOps';

describe('/sentinel security-approve', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows usage when no repo is given', async () => {
    await handleRepoOpsCmd('security-approve', ['/sentinel', 'security-approve'], null, null);
    expect(resolveAllOpenIssuesMock).not.toHaveBeenCalled();
    expect(sendTelegramMessageMock.mock.calls[0][0]).toContain('Usage:');
  });

  it('actually resolves open issues in the DB and reports the count (regression: used to be a no-op)', async () => {
    resolveAllOpenIssuesMock.mockResolvedValue(3);
    await handleRepoOpsCmd('security-approve', ['/sentinel', 'security-approve', 'tapcash'], null, 42);

    expect(resolveAllOpenIssuesMock).toHaveBeenCalledWith('your-org/tapcash');
    const [message] = sendTelegramMessageMock.mock.calls[0];
    expect(message).toContain('3 open issue(s) marked resolved');
  });

  it('reports 0 and does not throw when the DB call fails', async () => {
    resolveAllOpenIssuesMock.mockRejectedValue(new Error('db down'));
    await expect(
      handleRepoOpsCmd('security-approve', ['/sentinel', 'security-approve', 'tapcash'], null, 42)
    ).resolves.toBe(true);

    const [message] = sendTelegramMessageMock.mock.calls[0];
    expect(message).toContain('0 open issue(s) marked resolved');
  });
});
