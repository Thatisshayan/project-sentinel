jest.mock('../src/utils/safeFire', () => ({
  safeFire: jest.fn(async (p: Promise<unknown>) => {
    try { await p; } catch { /* swallow */ }
  }),
  fireAndForget: jest.fn(),
}));

jest.mock('../src/logger', () => ({
  __esModule: true,
  default: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const sendTelegramMessageMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/telegramClient', () => ({
  sendTelegramMessage: (...args: unknown[]) => sendTelegramMessageMock(...args),
}));

const triggerAuditMock = jest.fn().mockResolvedValue({ started: true });
jest.mock('../src/auditOrchestrator', () => ({
  executeApprovedTasks: jest.fn(),
  triggerAudit: (...args: unknown[]) => triggerAuditMock(...args),
  processNextBatch: jest.fn(),
}));

const getDefaultBranchMock = jest.fn().mockResolvedValue('develop');
jest.mock('../src/repoDiscovery', () => ({
  getDefaultBranch: (...args: unknown[]) => getDefaultBranchMock(...args),
}));

jest.mock('../src/repoResolver', () => ({
  repoFullName: (name: string) => `your-org/${name}`,
  getGithubOrg: jest.fn(),
  canonicalizeRepoName: jest.fn(),
}));

jest.mock('../src/notionClient', () => ({ findNotionProject: jest.fn() }));
jest.mock('../src/dbClient', () => ({ stopDebugAttempts: jest.fn(), getDebugAttempt: jest.fn(), query: jest.fn() }));
jest.mock('../src/buildPoller', () => ({ checkAllProviders: jest.fn() }));
jest.mock('../src/debugOrchestrator', () => ({ orchestrateDebug: jest.fn() }));
jest.mock('../src/auditDb', () => ({ stopAllTasksForRepo: jest.fn(), getNextBatch: jest.fn(), updateAuditTask: jest.fn() }));
jest.mock('../src/auditTaskWriter', () => ({ updateNotionTaskStatus: jest.fn() }));
jest.mock('../src/telegramAI', () => ({ handleMessage: jest.fn() }));
jest.mock('../src/sprintOrchestrator', () => ({ approveSprint: jest.fn(), getSprintStatus: jest.fn(), pauseSprint: jest.fn(), resumeSprint: jest.fn() }));
jest.mock('../src/velocityTracker', () => ({ getVelocityReport: jest.fn() }));
jest.mock('../src/agentRoom', () => ({ getAgentRoomSummary: jest.fn(), answerCallback: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/parallelExecutor', () => ({ executePortfolioTasks: jest.fn() }));
jest.mock('../src/agentDb', () => ({ getAllAgents: jest.fn().mockResolvedValue([]) }));
jest.mock('../src/performanceTracker', () => ({ getPerformanceReport: jest.fn() }));
jest.mock('../src/promptOptimizer', () => ({ getPromptReport: jest.fn() }));
jest.mock('../src/selfAuditor', () => ({ runSelfAudit: jest.fn() }));
jest.mock('../src/weeklyBusinessReport', () => ({ generateWeeklyReport: jest.fn() }));
jest.mock('../src/businessMetrics', () => ({ getRepoBusinessSummary: jest.fn() }));
jest.mock('../src/correlationEngine', () => ({ getCorrelationSummary: jest.fn() }));
jest.mock('../src/roiScorer', () => ({ scoreAllQueuedTasks: jest.fn() }));
jest.mock('../src/telegramMenus', () => ({ showMainMenu: jest.fn() }));
jest.mock('../src/dailyReport', () => ({ sendDailyReport: jest.fn() }));
jest.mock('../src/costTracker', () => ({ getCostReport: jest.fn() }));
jest.mock('../src/agentReplies', () => ({ detectAgentReply: jest.fn(), handleAgentReply: jest.fn() }));
jest.mock('../src/conflictDetector', () => ({ getPendingConflict: jest.fn(), resolvePendingConflict: jest.fn(), releaseAllLocks: jest.fn() }));
jest.mock('../src/commands/agents', () => ({ handleAgentsCmd: jest.fn().mockResolvedValue(false) }));
jest.mock('../src/commands/repoOps', () => ({ handleRepoOpsCmd: jest.fn().mockResolvedValue(false), handleHelp: jest.fn().mockResolvedValue(false) }));
jest.mock('../src/commands/reports', () => ({ handleReportsCmd: jest.fn().mockResolvedValue(false) }));
jest.mock('../src/commands/sprint', () => ({ handleSprintCmd: jest.fn().mockResolvedValue(false) }));
jest.mock('../src/commandRegistry', () => ({ dispatchCommand: jest.fn().mockResolvedValue(false) }));

import { handleCallbackQuery } from '../src/telegramCommands';

describe('telegramCommands.handleCallbackQuery repo:audit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getDefaultBranchMock.mockResolvedValue('develop');
  });

  it('resolves the repo default branch for inline repo audit callbacks', async () => {
    const handled = await handleCallbackQuery({
      id: 'cb-1',
      data: 'repo:audit:tapcash',
      message: { message_thread_id: 777, chat: { id: 123 } },
    });

    expect(handled).toBe(true);
    expect(getDefaultBranchMock).toHaveBeenCalledWith('your-org/tapcash');
    expect(triggerAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      repoFullName: 'your-org/tapcash',
      repoName: 'tapcash',
      branchName: 'develop',
      topicId: 777,
    }));
    expect(sendTelegramMessageMock).toHaveBeenCalledWith('Audit triggered for tapcash.', null, 777);
  });
});
