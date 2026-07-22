const sendTelegramMessageMock = jest.fn().mockResolvedValue(undefined);

jest.mock('../src/telegramClient', () => ({
  sendTelegramMessage: (...a: any[]) => sendTelegramMessageMock(...a),
}));
jest.mock('../src/repoResolver', () => ({
  repoFullName: (name: string) => `your-org/${name}`,
  canonicalizeRepoName: (name: string) => (name ? { repoName: name } : null),
}));
jest.mock('../src/auditOrchestrator', () => ({
  executeApprovedTasks: jest.fn().mockResolvedValue(undefined),
  triggerAudit: jest.fn().mockResolvedValue(undefined),
  processNextBatch: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/auditDb', () => ({ stopAllTasksForRepo: jest.fn(), updateAuditTask: jest.fn() }));
jest.mock('../src/agentDb', () => ({ getAllAgents: jest.fn().mockResolvedValue([]) }));
jest.mock('../src/notionClient', () => ({ findNotionProject: jest.fn().mockResolvedValue(null) }));
jest.mock('../src/dbClient', () => ({ stopDebugAttempts: jest.fn(), query: jest.fn() }));
jest.mock('../src/securityDb', () => ({
  getOpenIssues: jest.fn().mockResolvedValue([]),
  getLatestSecurityScore: jest.fn().mockResolvedValue(null),
  getPortfolioSecuritySummary: jest.fn().mockResolvedValue([]),
}));
jest.mock('../src/securityScanner', () => ({ runSecurityScan: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/agentRoom', () => ({ getAgentRoomSummary: jest.fn().mockResolvedValue('') }));
jest.mock('../src/selfAuditor', () => ({ runSelfAudit: jest.fn() }));
jest.mock('../src/sprintOrchestrator', () => ({
  approveSprint: jest.fn(), getSprintStatus: jest.fn().mockResolvedValue(undefined),
  pauseSprint: jest.fn(), resumeSprint: jest.fn(),
}));
jest.mock('../src/velocityTracker', () => ({ getVelocityReport: jest.fn() }));
jest.mock('../src/dailyReport', () => ({ sendDailyReport: jest.fn() }));
jest.mock('../src/costTracker', () => ({ getCostReport: jest.fn().mockResolvedValue({ formatted: '' }) }));
jest.mock('../src/portfolioDb', () => ({ getOpenPatterns: jest.fn().mockResolvedValue([]) }));
jest.mock('../src/agents/roundtable', () => ({
  startRoundtable: jest.fn().mockResolvedValue({ ok: true, sessionId: 1 }),
}));

import { dispatchCommand } from '../src/commandRegistry';
import { runSecurityScan } from '../src/securityScanner';
import { triggerAudit } from '../src/auditOrchestrator';
import { getSprintStatus } from '../src/sprintOrchestrator';
import { startRoundtable } from '../src/agents/roundtable';

describe('commandRegistry — verb-first dispatch (Phase 0)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('routes "audit <repo>" to the same handler as the legacy /sentinel audit', async () => {
    const dispatched = await dispatchCommand('audit costpilot', '123', 42);
    expect(dispatched).toBe(true);
    expect(triggerAudit).toHaveBeenCalled();
  });

  it('routes multi-word "security scan <repo>" correctly, not matching bare "security" first', async () => {
    const dispatched = await dispatchCommand('security scan costpilot', '123', 42);
    expect(dispatched).toBe(true);
    expect(runSecurityScan).toHaveBeenCalledWith(
      expect.objectContaining({ repoName: 'costpilot' })
    );
  });

  it('routes "sprint status" to getSprintStatus, not confused with bare "sprint"', async () => {
    const dispatched = await dispatchCommand('sprint status', '123', 42);
    expect(dispatched).toBe(true);
    expect(getSprintStatus).toHaveBeenCalledWith(42);
  });

  it('is case-insensitive on the verb but preserves arg casing', async () => {
    const dispatched = await dispatchCommand('AUDIT MyRepo', '123', 42);
    expect(dispatched).toBe(true);
    expect(triggerAudit).toHaveBeenCalledWith(
      expect.objectContaining({ repoName: 'MyRepo' })
    );
  });

  it('routes "roundtable <repo> <question>" to startRoundtable with the joined question text (Phase 7)', async () => {
    const dispatched = await dispatchCommand('roundtable costpilot how should we approach the auth refactor', '123', 42);
    expect(dispatched).toBe(true);
    expect(startRoundtable).toHaveBeenCalledWith('costpilot', 'how should we approach the auth refactor');
  });

  it('returns false for unrecognized text so callers can fall back to AI routing', async () => {
    const dispatched = await dispatchCommand('hey can you help me with something', '123', 42);
    expect(dispatched).toBe(false);
  });

  it('returns false for empty text', async () => {
    expect(await dispatchCommand('', '123', 42)).toBe(false);
    expect(await dispatchCommand('   ', '123', 42)).toBe(false);
  });
});
