const sendTelegramMessageMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/telegramClient', () => ({
  sendTelegramMessage: (...a: any[]) => sendTelegramMessageMock(...a),
}));
jest.mock('../src/repoResolver', () => ({ repoFullName: (name: string) => `your-org/${name}` }));
jest.mock('../src/agentRoom', () => ({ getAgentRoomSummary: jest.fn() }));
jest.mock('../src/agentDb', () => ({ getAllAgents: jest.fn() }));
jest.mock('../src/selfAuditor', () => ({ runSelfAudit: jest.fn() }));
jest.mock('../src/auditOrchestrator', () => ({ executeApprovedTasks: jest.fn() }));

const dispatchToAgentMock = jest.fn();
const listExternalAgentsMock = jest.fn().mockResolvedValue([]);
jest.mock('../src/agents/externalAgentRegistry', () => ({
  dispatchToAgent: (...a: any[]) => dispatchToAgentMock(...a),
  listExternalAgents: (...a: any[]) => listExternalAgentsMock(...a),
}));

import { handleAgentsCmd } from '../src/commands/agents';

describe('commands/agents.ts — assign', () => {
  beforeEach(() => jest.clearAllMocks());

  it('dispatches to the named agent with the joined task description', async () => {
    dispatchToAgentMock.mockResolvedValue({ ts: '123.456' });

    await handleAgentsCmd('assign', ['sentinel', 'assign', 'kilo', 'costpilot', 'fix', 'the', 'flaky', 'test'], null, 42);

    expect(dispatchToAgentMock).toHaveBeenCalledWith('kilo', 'fix the flaky test', 'costpilot');
    const [message, repoName] = sendTelegramMessageMock.mock.calls[0];
    expect(message).toContain('Dispatched to kilo');
    expect(repoName).toBe('costpilot'); // repoName must be passed, not null, for Slack fan-out (see 36031c9)
  });

  it('reports failure clearly (not silent success) when dispatch resolves null', async () => {
    dispatchToAgentMock.mockResolvedValue(null);
    await handleAgentsCmd('assign', ['sentinel', 'assign', 'kilo', 'costpilot', 'do', 'x'], null, 42);
    const [message] = sendTelegramMessageMock.mock.calls[0];
    expect(message).toContain('Could not dispatch');
  });

  it('shows usage + the available agent roster when args are missing', async () => {
    listExternalAgentsMock.mockResolvedValue([
      { id: 'kilo', enabled: true }, { id: 'manus', enabled: true },
    ]);
    await handleAgentsCmd('assign', ['sentinel', 'assign'], null, 42);
    const [message] = sendTelegramMessageMock.mock.calls[0];
    expect(message).toContain('Usage:');
    expect(message).toContain('kilo, manus');
    expect(dispatchToAgentMock).not.toHaveBeenCalled();
  });
});
