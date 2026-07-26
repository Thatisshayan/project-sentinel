const sendTelegramMessageMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/telegramClient', () => ({
  sendTelegramMessage: (...a: any[]) => sendTelegramMessageMock(...a),
}));
jest.mock('../src/repoResolver', () => ({
  repoFullName: (name: string) => `your-org/${name}`,
  // handleRepoOpsCmd canonicalizes parts[2] before any subcommand handler
  // sees it — returning null (no match) here means it's a no-op for these
  // tests, same as it would be for a genuinely unknown name like "the".
  canonicalizeRepoName: jest.fn().mockReturnValue(null),
}));
jest.mock('../src/notionClient', () => ({ findNotionProject: jest.fn().mockResolvedValue(null) }));
jest.mock('../src/agentDb', () => ({ getAllAgents: jest.fn() }));
jest.mock('../src/dbClient', () => ({ stopDebugAttempts: jest.fn(), query: jest.fn() }));
jest.mock('../src/autoApprover', () => ({ cancelAutoApprove: jest.fn() }));
jest.mock('../src/settingsDb', () => ({ updateSettings: jest.fn() }));

const triggerAuditMock = jest.fn().mockResolvedValue({ started: true });
jest.mock('../src/auditOrchestrator', () => ({
  executeApprovedTasks: jest.fn(), triggerAudit: (...a: any[]) => triggerAuditMock(...a), processNextBatch: jest.fn(),
}));
jest.mock('../src/auditDb', () => ({ stopAllTasksForRepo: jest.fn(), updateAuditTask: jest.fn() }));

const getFullRepoListMock = jest.fn();
const getDefaultBranchMock = jest.fn().mockResolvedValue('main');
jest.mock('../src/repoDiscovery', () => ({
  getFullRepoList: (...a: any[]) => getFullRepoListMock(...a),
  getDefaultBranch: (...a: any[]) => getDefaultBranchMock(...a),
}));

import { handleRepoOpsCmd } from '../src/commands/repoOps';

describe('commands/repoOps.ts — manual audit repo-name validation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('denies and does not trigger an audit for a repo name not in the tracked list (the "audit the" bug, confirmed live 2026-07-22)', async () => {
    getFullRepoListMock.mockResolvedValue([
      { repoName: 'costpilot', repoFullName: 'your-org/costpilot' },
      { repoName: 'mint', repoFullName: 'your-org/mint' },
    ]);

    await handleRepoOpsCmd('audit', ['sentinel', 'audit', 'the'], null, 42);

    expect(triggerAuditMock).not.toHaveBeenCalled();
    const [message] = sendTelegramMessageMock.mock.calls[0];
    expect(message).toContain('No tracked repo named "the"');
    expect(message).toContain('costpilot');
    expect(message).toContain('mint');
  });

  it('matches case-insensitively and uses the canonical repoName/repoFullName from the tracked list', async () => {
    getFullRepoListMock.mockResolvedValue([
      { repoName: 'CostPilot', repoFullName: 'your-org/CostPilot' },
    ]);

    await handleRepoOpsCmd('audit', ['sentinel', 'audit', 'costpilot'], null, 42);

    expect(triggerAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      repoName: 'CostPilot',
      repoFullName: 'your-org/CostPilot',
    }));
  });

  it('proceeds without validation (rather than blocking a legitimate audit) when the repo-list lookup itself fails', async () => {
    getFullRepoListMock.mockRejectedValue(new Error('GitHub API down'));

    await handleRepoOpsCmd('audit', ['sentinel', 'audit', 'costpilot'], null, 42);

    expect(triggerAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      repoName: 'costpilot',
      repoFullName: 'your-org/costpilot',
    }));
  });

  it('shows usage when no repo arg is given', async () => {
    await handleRepoOpsCmd('audit', ['sentinel', 'audit'], null, 42);
    expect(triggerAuditMock).not.toHaveBeenCalled();
    expect(getFullRepoListMock).not.toHaveBeenCalled();
    const [message] = sendTelegramMessageMock.mock.calls[0];
    expect(message).toContain('Usage:');
  });
});
