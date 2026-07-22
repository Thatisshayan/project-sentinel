// Regression guard for docs/2026-07-22-slack-agent-roster-plan.md's
// "repoName: null" gap — several command-handler replies passed null as
// the repoName argument to sendTelegramMessage even though a specific repo
// was known, which silently drops those messages from Slack's fan-out
// (slackClient.ts looks up the destination Slack channel by repoName).
// Covers a representative sample across repoOps.ts and reports.ts, not
// exhaustive — see the plan doc for the full audited/fixed list.

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
  triggerAudit: jest.fn().mockResolvedValue({ started: true }),
  processNextBatch: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/auditDb', () => ({ stopAllTasksForRepo: jest.fn().mockResolvedValue(undefined), updateAuditTask: jest.fn() }));
jest.mock('../src/agentDb', () => ({ getAllAgents: jest.fn().mockResolvedValue([]) }));
jest.mock('../src/notionClient', () => ({ findNotionProject: jest.fn().mockResolvedValue(null) }));
jest.mock('../src/dbClient', () => ({ stopDebugAttempts: jest.fn(), query: jest.fn().mockResolvedValue({ rows: [] }) }));
jest.mock('../src/repoLock', () => ({
  lockRepo: jest.fn().mockResolvedValue(undefined),
  unlockRepo: jest.fn().mockResolvedValue(undefined),
  getAllLocked: jest.fn().mockResolvedValue([]),
}));

import { handleRepoOpsCmd } from '../src/commands/repoOps';

describe('repoOps command replies pass the actual repoName (not null) when one is known', () => {
  beforeEach(() => jest.clearAllMocks());

  it('audit <repo>', async () => {
    await handleRepoOpsCmd('audit', ['/sentinel', 'audit', 'costpilot'], null, 42);
    const [, repoName] = sendTelegramMessageMock.mock.calls[0];
    expect(repoName).toBe('costpilot');
  });

  it('execute <repo>', async () => {
    await handleRepoOpsCmd('execute', ['/sentinel', 'execute', 'costpilot'], null, 42);
    const [, repoName] = sendTelegramMessageMock.mock.calls[0];
    expect(repoName).toBe('costpilot');
  });

  it('lock <repo>', async () => {
    await handleRepoOpsCmd('lock', ['/sentinel', 'lock', 'costpilot'], null, 42);
    const [, repoName] = sendTelegramMessageMock.mock.calls[0];
    expect(repoName).toBe('costpilot');
  });

  it('unlock <repo>', async () => {
    await handleRepoOpsCmd('unlock', ['/sentinel', 'unlock', 'costpilot'], null, 42);
    const [, repoName] = sendTelegramMessageMock.mock.calls[0];
    expect(repoName).toBe('costpilot');
  });

  it('tasks <repo>', async () => {
    await handleRepoOpsCmd('tasks', ['/sentinel', 'tasks', 'costpilot'], null, 42);
    const [, repoName] = sendTelegramMessageMock.mock.calls[0];
    expect(repoName).toBe('costpilot');
  });

  it('still passes null for genuinely repo-agnostic messages (usage errors, portfolio-wide summaries)', async () => {
    await handleRepoOpsCmd('lock', ['/sentinel', 'lock'], null, 42); // missing repo arg — usage message
    const [message, repoName] = sendTelegramMessageMock.mock.calls[0];
    expect(message).toContain('Usage:');
    expect(repoName).toBeNull();
  });
});
