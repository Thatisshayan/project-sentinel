const sendTelegramMessageMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/telegramClient', () => ({
  sendTelegramMessage: (...a: any[]) => sendTelegramMessageMock(...a),
}));
jest.mock('../src/repoResolver', () => ({ repoFullName: (name: string) => `your-org/${name}` }));
jest.mock('../src/agentRoom', () => ({ getAgentRoomSummary: jest.fn() }));
jest.mock('../src/agentDb', () => ({ getAllAgents: jest.fn() }));
jest.mock('../src/selfAuditor', () => ({ runSelfAudit: jest.fn() }));
jest.mock('../src/auditOrchestrator', () => ({ executeApprovedTasks: jest.fn() }));
jest.mock('../src/agents/externalAgentRegistry', () => ({
  dispatchToAgent: jest.fn(), listExternalAgents: jest.fn().mockResolvedValue([]),
}));

const getRecentAuthorityLogMock = jest.fn();
const listAuthorityRulesMock = jest.fn();
jest.mock('../src/viktorAuthority', () => ({
  getRecentAuthorityLog: (...a: any[]) => getRecentAuthorityLogMock(...a),
  listAuthorityRules: (...a: any[]) => listAuthorityRulesMock(...a),
}));

import { handleAgentsCmd } from '../src/commands/agents';

describe('commands/agents.ts — viktor-log / viktor-rules (Phase 6 audit commands)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('viktor-log reports when there are no entries yet', async () => {
    getRecentAuthorityLogMock.mockResolvedValue([]);
    await handleAgentsCmd('viktor-log', ['sentinel', 'viktor-log'], null, 42);
    const [message] = sendTelegramMessageMock.mock.calls[0];
    expect(message).toContain('No Viktor authority-log entries');
  });

  it('viktor-log formats recent entries with decision, action, repo, target agent, and reasoning', async () => {
    getRecentAuthorityLogMock.mockResolvedValue([
      { created_at: '2026-07-22T10:00:00.000Z', decision: 'executed', action: 'delegate', target_repo: 'costpilot', target_agent: 'kilo', reasoning: 'Delegated: fix x' },
    ]);
    await handleAgentsCmd('viktor-log', ['sentinel', 'viktor-log', 'costpilot'], null, 42);
    expect(getRecentAuthorityLogMock).toHaveBeenCalledWith(20, 'costpilot');
    const [message] = sendTelegramMessageMock.mock.calls[0];
    expect(message).toContain('EXECUTED');
    expect(message).toContain('delegate');
    expect(message).toContain('costpilot');
    expect(message).toContain('kilo');
  });

  it('viktor-rules shows enabled/disabled state for every seeded action type', async () => {
    listAuthorityRulesMock.mockResolvedValue([
      { actionType: 'sprint_approve', maxScope: { max_tasks: 5 }, canDelegateTo: null, enabled: false },
      { actionType: 'delegate', maxScope: {}, canDelegateTo: ['kilo'], enabled: true },
    ]);
    await handleAgentsCmd('viktor-rules', ['sentinel', 'viktor-rules'], null, 42);
    const [message] = sendTelegramMessageMock.mock.calls[0];
    expect(message).toContain('sprint_approve');
    expect(message).toContain('⬜');
    expect(message).toContain('delegate');
    expect(message).toContain('✅');
    expect(message).toContain('can_delegate_to=[kilo]');
  });
});
