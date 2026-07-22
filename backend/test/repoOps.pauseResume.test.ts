const sendTelegramMessageMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/telegramClient', () => ({
  sendTelegramMessage: (...a: any[]) => sendTelegramMessageMock(...a),
}));
jest.mock('../src/repoResolver', () => ({ repoFullName: (name: string) => `your-org/${name}` }));
jest.mock('../src/notionClient', () => ({ findNotionProject: jest.fn() }));
jest.mock('../src/auditOrchestrator', () => ({
  executeApprovedTasks: jest.fn(), triggerAudit: jest.fn(), processNextBatch: jest.fn(),
}));
jest.mock('../src/auditDb', () => ({ stopAllTasksForRepo: jest.fn(), updateAuditTask: jest.fn() }));
jest.mock('../src/agentDb', () => ({ getAllAgents: jest.fn() }));

const dbQueryMock = jest.fn().mockResolvedValue({ rows: [] });
jest.mock('../src/dbClient', () => ({
  stopDebugAttempts: jest.fn(),
  query: (...a: any[]) => dbQueryMock(...a),
}));

const cancelAutoApproveMock = jest.fn().mockResolvedValue(true);
jest.mock('../src/autoApprover', () => ({ cancelAutoApprove: (...a: any[]) => cancelAutoApproveMock(...a) }));

const updateSettingsMock = jest.fn().mockResolvedValue({});
jest.mock('../src/settingsDb', () => ({ updateSettings: (...a: any[]) => updateSettingsMock(...a) }));

import { handleRepoOpsCmd } from '../src/commands/repoOps';

describe('commands/repoOps.ts — pause/resume set the Phase 6 kill-switch flag', () => {
  beforeEach(() => jest.clearAllMocks());

  it('pause sets sentinel_paused=true, in addition to its existing cancel/idle behavior', async () => {
    await handleRepoOpsCmd('pause', ['sentinel', 'pause'], null, 42);
    expect(cancelAutoApproveMock).toHaveBeenCalled();
    expect(dbQueryMock).toHaveBeenCalledWith(expect.stringContaining("status='paused'"));
    expect(updateSettingsMock).toHaveBeenCalledWith({ sentinel_paused: true });
    const [message] = sendTelegramMessageMock.mock.calls[0];
    expect(message).toContain('Viktor-initiated actions will be denied');
  });

  it('resume sets sentinel_paused=false', async () => {
    await handleRepoOpsCmd('resume', ['sentinel', 'resume'], null, 42);
    expect(dbQueryMock).toHaveBeenCalledWith(expect.stringContaining("status='idle'"));
    expect(updateSettingsMock).toHaveBeenCalledWith({ sentinel_paused: false });
  });

  it('pause still confirms the automation-paused message even if setting the kill-switch flag fails', async () => {
    updateSettingsMock.mockRejectedValue(new Error('db down'));
    await handleRepoOpsCmd('pause', ['sentinel', 'pause'], null, 42);
    const [message] = sendTelegramMessageMock.mock.calls[0];
    expect(message).toContain('All automation paused');
  });
});
