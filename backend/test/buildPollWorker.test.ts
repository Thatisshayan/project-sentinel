let capturedProcessor: ((job: any) => Promise<void>) | undefined;
const workerOnMock = jest.fn();

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((_name: string, processor: any) => {
    capturedProcessor = processor;
    return { on: workerOnMock };
  }),
}));

const getRedisConnectionMock = jest.fn();
const enqueueBuildCheckMock = jest.fn().mockResolvedValue(undefined);
const enqueueScheduledJobMock = jest.fn().mockResolvedValue({});
jest.mock('../src/queueClient', () => ({
  getRedisConnection: () => getRedisConnectionMock(),
  enqueueBuildCheck: (data: any) => enqueueBuildCheckMock(data),
  enqueueScheduledJob: (...a: any[]) => enqueueScheduledJobMock(...a),
}));

jest.mock('../src/agentDb', () => ({ releaseExpiredLocks: jest.fn() }));
jest.mock('../src/selfAuditor', () => ({ runSelfAudit: jest.fn() }));
jest.mock('../src/selfHealer', () => ({ checkAndHeal: jest.fn() }));
jest.mock('../src/businessMetrics', () => ({ pullAllMetrics: jest.fn() }));
jest.mock('../src/roiScorer', () => ({ scoreAllQueuedTasks: jest.fn() }));
jest.mock('../src/weeklyBusinessReport', () => ({ generateWeeklyReport: jest.fn() }));

const runSecurityScanMock = jest.fn().mockReturnValue(Promise.resolve());
jest.mock('../src/securityScanner', () => ({ runSecurityScan: (...a: any[]) => runSecurityScanMock(...a) }));

jest.mock('../src/monthlySecurityReport', () => ({ generateMonthlySecurityReport: jest.fn() }));

const checkAllProvidersMock = jest.fn();
jest.mock('../src/buildPoller', () => ({ checkAllProviders: (...a: any[]) => checkAllProvidersMock(...a) }));

const orchestrateDebugMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/debugOrchestrator', () => ({ orchestrateDebug: (...a: any[]) => orchestrateDebugMock(...a) }));

const sendTelegramMessageMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/telegramClient', () => ({ sendTelegramMessage: (...a: any[]) => sendTelegramMessageMock(...a) }));

const findNotionProjectMock = jest.fn();
const updateNotionProjectMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/notionClient', () => ({
  findNotionProject: (...a: any[]) => findNotionProjectMock(...a),
  updateNotionProject: (...a: any[]) => updateNotionProjectMock(...a),
}));

const triggerAuditMock = jest.fn().mockResolvedValue(undefined);
const handleBuildPassedAfterSentinelMergeMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/auditOrchestrator', () => ({
  triggerAudit: (...a: any[]) => triggerAuditMock(...a),
  handleBuildPassedAfterSentinelMerge: (...a: any[]) => handleBuildPassedAfterSentinelMergeMock(...a),
}));

jest.mock('../src/dailyReport', () => ({ sendDailyReport: jest.fn() }));
jest.mock('../src/patternDetector', () => ({ detectPatterns: jest.fn() }));

const refreshRepoMetricsMock = jest.fn().mockReturnValue(Promise.resolve());
jest.mock('../src/portfolioAnalytics', () => ({
  refreshAllMetrics: jest.fn(),
  refreshRepoMetrics: (...a: any[]) => refreshRepoMetricsMock(...a),
}));

jest.mock('../src/githubMetricsSyncer', () => ({ syncAllRepoMetrics: jest.fn() }));

const updateDashboardMock = jest.fn().mockReturnValue(Promise.resolve());
jest.mock('../src/notionDashboard', () => ({ updateDashboard: () => updateDashboardMock() }));

jest.mock('../src/sprintPlanner', () => ({ generateSprintProposal: jest.fn() }));
jest.mock('../src/velocityTracker', () => ({ recordWeeklyVelocity: jest.fn() }));

const dbQueryMock = jest.fn();
jest.mock('../src/dbClient', () => ({ query: (...a: any[]) => dbQueryMock(...a) }));

const fireAndForgetMock = jest.fn();
jest.mock('../src/utils/safeFire', () => ({
  safeFire: (p: any) => p,
  fireAndForget: (...a: any[]) => fireAndForgetMock(...a),
}));

import { startBuildPollWorker } from '../src/workers/buildPollWorker';

const baseJobData = {
  repoFullName: 'org/repo',
  commitSha: 'abcdef1234567890',
  repoName: 'repo',
  projectName: 'Repo Project',
  topicId: 5,
  branchName: 'main',
};

describe('startBuildPollWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedProcessor = undefined;
    getRedisConnectionMock.mockReturnValue({});
    findNotionProjectMock.mockResolvedValue({ pageId: 'page-1' });
  });

  it('returns null when Redis is not configured', () => {
    getRedisConnectionMock.mockReturnValue(null);
    expect(startBuildPollWorker()).toBeNull();
  });

  it('re-queues with an incremented attempt count while build is pending', async () => {
    checkAllProvidersMock.mockResolvedValue({ overall: 'pending' });
    startBuildPollWorker();

    await capturedProcessor!({ data: { ...baseJobData, attemptNumber: 3 } });

    expect(enqueueBuildCheckMock).toHaveBeenCalledWith(
      expect.objectContaining({ attemptNumber: 4 })
    );
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });

  it('sends a timeout alert instead of re-queuing once max attempts is reached', async () => {
    checkAllProvidersMock.mockResolvedValue({ overall: 'pending' });
    startBuildPollWorker();

    await capturedProcessor!({ data: { ...baseJobData, attemptNumber: 20 } });

    expect(enqueueBuildCheckMock).not.toHaveBeenCalled();
    expect(sendTelegramMessageMock).toHaveBeenCalledWith(
      expect.stringContaining('Build Timeout'),
      baseJobData.repoName,
      baseJobData.topicId
    );
  });

  it('skips silently when no build provider is configured', async () => {
    checkAllProvidersMock.mockResolvedValue({ overall: 'not_configured' });
    startBuildPollWorker();

    await capturedProcessor!({ data: { ...baseJobData, attemptNumber: 0 } });

    expect(updateNotionProjectMock).not.toHaveBeenCalled();
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });

  it('on success for a human commit: updates Notion, sends a pass message, and schedules a CodeRabbit-fallback audit (not an immediate triggerAudit)', async () => {
    // Phase 2 of docs/2026-07-22-slack-agent-roster-plan.md — CodeRabbit is
    // now the primary audit engine; Sentinel's own triggerAudit only runs
    // as a delayed fallback if CodeRabbit's webhook never lands, so a
    // successful human-commit build schedules that fallback job rather than
    // auditing immediately.
    checkAllProvidersMock.mockResolvedValue({ overall: 'success', buildProvider: 'railway' });
    startBuildPollWorker();

    await capturedProcessor!({ data: { ...baseJobData, branchName: 'main', attemptNumber: 0 } });

    expect(updateNotionProjectMock).toHaveBeenCalledWith('page-1', expect.objectContaining({
      deploymentStatus: 'success',
      currentProjectState: 'Resolved',
    }));
    expect(sendTelegramMessageMock).toHaveBeenCalledWith(
      expect.stringContaining('Build Passed'),
      baseJobData.repoName,
      baseJobData.topicId
    );
    expect(enqueueScheduledJobMock).toHaveBeenCalledWith(
      'coderabbit-fallback-audit',
      expect.objectContaining({ repoFullName: baseJobData.repoFullName, commitSha: baseJobData.commitSha }),
      expect.any(Number),
      expect.stringContaining(baseJobData.repoFullName)
    );
    expect(triggerAuditMock).not.toHaveBeenCalled();
    expect(handleBuildPassedAfterSentinelMergeMock).not.toHaveBeenCalled();
    expect(runSecurityScanMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to an immediate triggerAudit if scheduling the CodeRabbit-fallback job itself fails', async () => {
    checkAllProvidersMock.mockResolvedValue({ overall: 'success', buildProvider: 'railway' });
    enqueueScheduledJobMock.mockRejectedValueOnce(new Error('redis down'));
    startBuildPollWorker();

    await capturedProcessor!({ data: { ...baseJobData, branchName: 'main', attemptNumber: 0 } });

    expect(triggerAuditMock).toHaveBeenCalledTimes(1);
  });

  it('on success for a sentinel/ branch: marks tasks done via handleBuildPassedAfterSentinelMerge, not triggerAudit', async () => {
    checkAllProvidersMock.mockResolvedValue({ overall: 'success', buildProvider: 'railway' });
    startBuildPollWorker();

    await capturedProcessor!({
      data: { ...baseJobData, branchName: 'sentinel/task-123', attemptNumber: 0 },
    });

    expect(handleBuildPassedAfterSentinelMergeMock).toHaveBeenCalledWith(
      baseJobData.repoFullName, baseJobData.repoName, 'sentinel/task-123', baseJobData.topicId
    );
    expect(triggerAuditMock).not.toHaveBeenCalled();
  });

  it('does not trigger audit on success when AUDIT_AGENT_ENABLED=false', async () => {
    const original = process.env.AUDIT_AGENT_ENABLED;
    process.env.AUDIT_AGENT_ENABLED = 'false';
    checkAllProvidersMock.mockResolvedValue({ overall: 'success', buildProvider: 'railway' });
    startBuildPollWorker();

    await capturedProcessor!({ data: { ...baseJobData, branchName: 'main', attemptNumber: 0 } });

    expect(triggerAuditMock).not.toHaveBeenCalled();
    process.env.AUDIT_AGENT_ENABLED = original;
  });

  it('on failure for a human commit: sends a failure message and runs the debug orchestrator', async () => {
    checkAllProvidersMock.mockResolvedValue({ overall: 'failed', buildProvider: 'railway', failureReason: 'tests failed' });
    startBuildPollWorker();

    await capturedProcessor!({ data: { ...baseJobData, branchName: 'main', attemptNumber: 0 } });

    expect(sendTelegramMessageMock).toHaveBeenCalledWith(
      expect.stringContaining('Build Failed'),
      baseJobData.repoName,
      baseJobData.topicId
    );
    expect(orchestrateDebugMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock).not.toHaveBeenCalled();
  });

  it('on failure for a sentinel/ branch: re-queues recently-done tasks instead of debugging', async () => {
    checkAllProvidersMock.mockResolvedValue({ overall: 'failed', buildProvider: 'railway', failureReason: 'tests failed' });
    dbQueryMock.mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }] });
    startBuildPollWorker();

    await capturedProcessor!({
      data: { ...baseJobData, branchName: 'sentinel/task-123', attemptNumber: 0 },
    });

    expect(orchestrateDebugMock).not.toHaveBeenCalled();
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    expect(sendTelegramMessageMock).toHaveBeenCalledWith(
      expect.stringContaining('re-queued'),
      baseJobData.repoName,
      baseJobData.topicId
    );
  });

  it('registers a failed-job handler that logs without throwing', () => {
    startBuildPollWorker();
    expect(workerOnMock).toHaveBeenCalledWith('failed', expect.any(Function));
    const handler = workerOnMock.mock.calls[0][1];
    expect(() => handler({ id: 'j1' }, new Error('boom'))).not.toThrow();
  });
});
