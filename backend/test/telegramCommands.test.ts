/**
 * M-5 contract tests for handleCommand's chatId parameter.
 *
 * Covers the widened signature `chatId: number | null` and the
 * null-coalescing at the Telegram push boundary (showMainMenu).
 * Heavy downstream modules are mocked so we isolate dispatch logic.
 */

jest.mock('../src/utils/safeFire', () => ({
  safeFire: jest.fn(async (p: any) => {
    try { await p; } catch { /* swallow */ }
  }),
  fireAndForget: jest.fn(),
}));

jest.mock('../src/logger', () => ({
  __esModule: true,
  default: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../src/repoResolver', () => ({ repoFullName: jest.fn(), getGithubOrg: jest.fn(), canonicalizeRepoName: jest.fn() }));
jest.mock('../src/telegramClient', () => ({ sendTelegramMessage: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/notionClient', () => ({ findNotionProject: jest.fn() }));
jest.mock('../src/dbClient', () => ({
  stopDebugAttempts: jest.fn(),
  getDebugAttempt: jest.fn(),
  query: jest.fn(),
}));
jest.mock('../src/buildPoller', () => ({ checkAllProviders: jest.fn(), checkGitHubActions: jest.fn(), checkVercel: jest.fn(), checkRailway: jest.fn() }));
jest.mock('../src/debugOrchestrator', () => ({ orchestrateDebug: jest.fn() }));
jest.mock('../src/auditOrchestrator', () => ({
  executeApprovedTasks: jest.fn(),
  triggerAudit: jest.fn(),
  processNextBatch: jest.fn(),
}));
jest.mock('../src/auditDb', () => ({
  stopAllTasksForRepo: jest.fn(),
  getNextBatch: jest.fn(),
  updateAuditTask: jest.fn(),
}));
jest.mock('../src/auditTaskWriter', () => ({ updateNotionTaskStatus: jest.fn(), writeTasksToNotion: jest.fn() }));
jest.mock('../src/telegramAI', () => ({ handleMessage: jest.fn() }));
jest.mock('../src/sprintOrchestrator', () => ({
  approveSprint: jest.fn(),
  getSprintStatus: jest.fn(),
  pauseSprint: jest.fn(),
  resumeSprint: jest.fn(),
}));
jest.mock('../src/velocityTracker', () => ({ getVelocityReport: jest.fn() }));
jest.mock('../src/agentRoom', () => ({ getAgentRoomSummary: jest.fn().mockResolvedValue(''), answerCallback: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/parallelExecutor', () => ({ executePortfolioTasks: jest.fn(), executeTaskParallel: jest.fn() }));
jest.mock('../src/agentDb', () => ({
  getAllAgents: jest.fn().mockResolvedValue([]),
  logAgentMessage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/performanceTracker', () => ({ trackModelCall: jest.fn(), getRecommendedModel: jest.fn(), getPerformanceReport: jest.fn() }));
jest.mock('../src/promptOptimizer', () => ({ initDefaultPrompts: jest.fn(), recordPromptOutcome: jest.fn(), getPromptReport: jest.fn() }));
jest.mock('../src/selfAuditor', () => ({ runSelfAudit: jest.fn() }));
jest.mock('../src/weeklyBusinessReport', () => ({ generateWeeklyReport: jest.fn() }));
jest.mock('../src/businessMetrics', () => ({ getRepoBusinessSummary: jest.fn() }));
jest.mock('../src/correlationEngine', () => ({
  snapshotBeforeMerge: jest.fn(),
  checkPostMergeImpact: jest.fn(),
  getCorrelationSummary: jest.fn(),
}));
jest.mock('../src/roiScorer', () => ({ scoreAllQueuedTasks: jest.fn() }));
jest.mock('../src/telegramMenus', () => ({
  showMainMenu: jest.fn().mockResolvedValue(undefined),
  showRepoMenu: jest.fn().mockResolvedValue(undefined),
  showApprovalsMenu: jest.fn().mockResolvedValue(undefined),
  showDidYouMean: jest.fn().mockResolvedValue(undefined),
  sendMenu: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/dailyReport', () => ({ sendDailyReport: jest.fn() }));
jest.mock('../src/costTracker', () => ({ getCostReport: jest.fn() }));
jest.mock('../src/agentReplies', () => ({ detectAgentReply: jest.fn(), handleAgentReply: jest.fn() }));
jest.mock('../src/conflictDetector', () => ({
  getPendingConflict: jest.fn(),
  resolvePendingConflict: jest.fn(),
  releaseAllLocks: jest.fn(),
}));

jest.mock('../src/commands/agents', () => ({ handleAgentsCmd: jest.fn().mockResolvedValue(false) }));
jest.mock('../src/commands/repoOps', () => ({ handleRepoOpsCmd: jest.fn().mockResolvedValue(false), handleHelp: jest.fn().mockResolvedValue(false) }));
jest.mock('../src/commands/reports', () => ({ handleReportsCmd: jest.fn().mockResolvedValue(false) }));
jest.mock('../src/commands/sprint', () => ({ handleSprintCmd: jest.fn().mockResolvedValue(false) }));
jest.mock('../src/commandRegistry', () => ({ dispatchCommand: jest.fn().mockResolvedValue(false) }));

import { handleCommand } from '../src/telegramCommands';
import { showMainMenu } from '../src/telegramMenus';
import { handleMessage } from '../src/telegramAI';
import { dispatchCommand } from '../src/commandRegistry';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('handleCommand chatId contract (M-5 fix)', () => {
  it('returns false for non-slash free-text with no agent-room topic (no AI route hit)', async () => {
    const result = await handleCommand('hello', null, null, 'Dashboard', null);
    expect(result).toBe(false);
    expect(showMainMenu).not.toHaveBeenCalled();
  });

  it('passes chatId=0 straight through to showMainMenu for /start (zero is preserved, not stringified to "null")', async () => {
    const result = await handleCommand('/start', 0, null, 'Dashboard', null);
    expect(result).toBe(true);
    expect(showMainMenu).toHaveBeenCalledTimes(1);
    expect(showMainMenu).toHaveBeenCalledWith(0, null);
  });

  it('coalesces null chatId to 0 at the Telegram push boundary (showMainMenu never sees null)', async () => {
    // Dashboard / null-chatId path: signature widened to number | null so this
    // must not throw; the Telegram-bound showMainMenu receives 0 (never null).
    const result = await handleCommand('/start', null, null, 'Dashboard', null);
    expect(result).toBe(true);
    expect(showMainMenu).toHaveBeenCalledTimes(1);
    expect(showMainMenu).toHaveBeenCalledWith(0, null);
  });

  it('handles /menu exactly like /start (coalesces null chatId to 0)', async () => {
    const result = await handleCommand('/menu', null, null, 'Shayan', null);
    expect(result).toBe(true);
    expect(showMainMenu).toHaveBeenCalledWith(0, null);
  });

  it('does not crash on a non-slash free-text hit that dispatchVerbCommand absorbs', async () => {
    (dispatchCommand as jest.Mock).mockResolvedValueOnce(true);
    const result = await handleCommand('audit myrepo', null, null, 'Dashboard', null);
    expect(result).toBe(true);
    expect(showMainMenu).not.toHaveBeenCalled();
    expect(dispatchCommand).toHaveBeenCalledWith('audit myrepo', String(null), null);
  });

  it('routes non-slash free-text inside agent-room topic to handleMessage (chatId null tolerated)', async () => {
    process.env.AGENT_ROOM_TOPIC_ID = '777';
    try {
      const result = await handleCommand('hi everyone', null, 777, 'Shayan', null);
      expect(result).toBe(false);
      expect(handleMessage).toHaveBeenCalledTimes(1);
      expect(handleMessage).toHaveBeenCalledWith('hi everyone', 'Shayan', 777, expect.any(String));
    } finally {
      delete process.env.AGENT_ROOM_TOPIC_ID;
    }
  });

  it('returns false for an unknown /sentinel subcommand and does not push to Telegram', async () => {
    const result = await handleCommand('/sentinel bogus', 0, null, 'Dashboard', null);
    expect(result).toBe(false);
    expect(showMainMenu).not.toHaveBeenCalled();
  });
});
