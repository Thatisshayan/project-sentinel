const queueAddMock = jest.fn().mockResolvedValue(undefined);
let capturedProcessor: ((job: any) => Promise<void>) | undefined;
const workerOnMock = jest.fn();

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: queueAddMock })),
  Worker: jest.fn().mockImplementation((_name: string, processor: any) => {
    capturedProcessor = processor;
    return { on: workerOnMock };
  }),
}));

const getRedisConnectionMock = jest.fn();
jest.mock('../src/queueClient', () => ({
  getRedisConnection: () => getRedisConnectionMock(),
  enqueueBuildCheck: jest.fn(),
}));

const fireAndForgetMock = jest.fn();
jest.mock('../src/utils/safeFire', () => ({
  safeFire: (p: any) => p,
  fireAndForget: (...a: any[]) => fireAndForgetMock(...a),
}));

const updatePinnedStatusBoardMock = jest.fn().mockResolvedValue(undefined);
const sendMorningBriefingMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/agentRoom', () => ({
  updatePinnedStatusBoard: () => updatePinnedStatusBoardMock(),
  sendMorningBriefing: () => sendMorningBriefingMock(),
}));

jest.mock('../src/businessMetrics', () => ({ pullAllMetrics: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/weeklyBusinessReport', () => ({ generateWeeklyReport: jest.fn().mockResolvedValue(undefined) }));

const generateMonthlySecurityReportMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/monthlySecurityReport', () => ({
  generateMonthlySecurityReport: () => generateMonthlySecurityReportMock(),
}));

jest.mock('../src/roiScorer', () => ({ scoreAllQueuedTasks: jest.fn().mockResolvedValue(undefined) }));

const sendDailyReportMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/dailyReport', () => ({ sendDailyReport: () => sendDailyReportMock() }));

const detectPatternsMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/patternDetector', () => ({ detectPatterns: () => detectPatternsMock() }));

const refreshAllMetricsMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/portfolioAnalytics', () => ({
  refreshAllMetrics: () => refreshAllMetricsMock(),
  REPO_LIST: [{ repoFullName: 'org/a', repoName: 'a' }, { repoFullName: 'org/b', repoName: 'b' }],
}));

jest.mock('../src/githubMetricsSyncer', () => ({ syncAllRepoMetrics: jest.fn().mockResolvedValue(undefined) }));

const updateDashboardMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/notionDashboard', () => ({ updateDashboard: () => updateDashboardMock() }));

const sendTelegramMessageMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/telegramClient', () => ({ sendTelegramMessage: (...a: any[]) => sendTelegramMessageMock(...a) }));

const triggerAuditMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/auditOrchestrator', () => ({ triggerAudit: (...a: any[]) => triggerAuditMock(...a) }));

const dbQueryMock = jest.fn();
jest.mock('../src/dbClient', () => ({ query: (...a: any[]) => dbQueryMock(...a) }));

// Lazily require()'d optional modules inside the source file.
jest.mock('../src/metricsFetcher', () => ({ fetchAllMetrics: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/selfScaler', () => ({ runSelfScaler: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/priorityEngine', () => ({ runPriorityEngine: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/ceoReport', () => ({ generateCEOReport: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/agentStandup', () => ({ runAgentStandup: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/agentLeaderboard', () => ({ postAgentLeaderboard: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/sentinelBrain', () => ({
  runStrategicBrain: jest.fn().mockResolvedValue(undefined),
  recordBrainOutcome: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/providerHealthCheck', () => ({ probeAIProviders: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/repoDiscovery', () => ({ discoverAndOnboardRepos: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/portfolioDb', () => ({ getDailyCost: jest.fn().mockResolvedValue(0) }));

import { startDailyReportWorker } from '../src/workers/dailyReportWorker';

describe('startDailyReportWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedProcessor = undefined;
    getRedisConnectionMock.mockReturnValue({});
  });

  it('returns null when Redis is not configured', () => {
    getRedisConnectionMock.mockReturnValue(null);
    expect(startDailyReportWorker()).toBeNull();
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it('schedules all 16 cron jobs when Redis is available', () => {
    startDailyReportWorker();
    const names = queueAddMock.mock.calls.map((c) => c[0]);
    expect(names).toEqual([
      'report', 'morning-briefing', 'pull-metrics', 'weekly-report',
      'monthly-security', 'priority-engine', 'agent-standup', 'ceo-report',
      'agent-leaderboard', 'weekly-audit', 'stale-tasks', 'provider-health',
      'github-metrics-sync', 'repo-discovery', 'brain-outcome', 'brain-strategy',
    ]);
  });

  it('morning-briefing job sends the briefing', async () => {
    startDailyReportWorker();
    await capturedProcessor!({ name: 'morning-briefing' });
    expect(sendMorningBriefingMock).toHaveBeenCalledTimes(1);
  });

  it('monthly-security job calls the (currently stub) report generator', async () => {
    startDailyReportWorker();
    await capturedProcessor!({ name: 'monthly-security' });
    expect(generateMonthlySecurityReportMock).toHaveBeenCalledTimes(1);
  });

  it('stale-tasks job reports nothing when there are no stale tasks', async () => {
    dbQueryMock.mockResolvedValue({ rows: [] });
    startDailyReportWorker();
    await capturedProcessor!({ name: 'stale-tasks' });
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });

  it('stale-tasks job reports counts when stale tasks exist', async () => {
    dbQueryMock.mockResolvedValue({ rows: [{ repo_full_name: 'org/repo', count: '3' }] });
    startDailyReportWorker();
    await capturedProcessor!({ name: 'stale-tasks' });
    expect(sendTelegramMessageMock).toHaveBeenCalledWith(
      expect.stringContaining('Stale Task Report'),
      null, null
    );
  });

  it('weekly-audit job triggers an audit per repo in REPO_LIST and reports the sweep summary', async () => {
    startDailyReportWorker();
    await capturedProcessor!({ name: 'weekly-audit' });
    expect(triggerAuditMock).toHaveBeenCalledTimes(2);
    expect(sendTelegramMessageMock).toHaveBeenCalledWith(
      expect.stringContaining('2/2 repos queued'),
      null, null
    );
  }, 15000);

  it('falls through to the default daily-report path (refreshAllMetrics, sendDailyReport, detectPatterns, updateDashboard) for unrecognized job names', async () => {
    startDailyReportWorker();
    await capturedProcessor!({ name: 'report' });
    expect(refreshAllMetricsMock).toHaveBeenCalledTimes(1);
    expect(sendDailyReportMock).toHaveBeenCalledTimes(1);
    expect(detectPatternsMock).toHaveBeenCalledTimes(1);
    expect(updateDashboardMock).toHaveBeenCalledTimes(1);
  });

  it('registers a failed-job handler that logs without throwing', () => {
    startDailyReportWorker();
    expect(workerOnMock).toHaveBeenCalledWith('failed', expect.any(Function));
    const handler = workerOnMock.mock.calls[0][1];
    expect(() => handler({ name: 'report' }, new Error('boom'))).not.toThrow();
  });
});
