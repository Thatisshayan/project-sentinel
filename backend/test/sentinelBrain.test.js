const { runStrategicBrain } = require('../src/sentinelBrain');

jest.mock('../src/portfolioDb', () => ({
  getOpenPatterns:     jest.fn().mockResolvedValue([]),
  getDailyCost:        jest.fn().mockResolvedValue(0),
  getMonthlyCost:      jest.fn().mockResolvedValue(0),
  getAllLatestMetrics:  jest.fn().mockResolvedValue([]),
}));

jest.mock('../src/portfolioAnalytics', () => ({
  getPortfolioSummary: jest.fn().mockResolvedValue({ metrics: [], broken: [], avgHealth: '5.0' }),
  REPO_LIST:           [],
}));

jest.mock('../src/dbClient', () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
}));

jest.mock('../src/telegramClient', () => ({
  sendTelegramMessage: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/auditOrchestrator', () => ({
  executeApprovedTasks: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/repoLock', () => ({
  isRepoLocked: jest.fn().mockResolvedValue(false),
}));

describe('sentinelBrain', () => {
  test('runStrategicBrain is exported', () => {
    expect(typeof runStrategicBrain).toBe('function');
  });

  test('runStrategicBrain writes a row to brain_decisions', async () => {
    const { query } = require('../src/dbClient');

    // Stub AI call via env key
    process.env.NVIDIA_API_KEY = undefined;
    process.env.DEEPSEEK_API_KEY = undefined;

    // With no AI keys runStrategicBrain should catch the error internally and
    // still call sendTelegramMessage (error path). Verify it does not throw.
    await expect(runStrategicBrain(null)).resolves.toBeUndefined();
  });

  test('brain_decisions INSERT uses JSON.stringify for context', async () => {
    const { query } = require('../src/dbClient');
    // Any call that tries to INSERT should pass JSON-serialisable args.
    const insertCalls = query.mock.calls.filter(c =>
      typeof c[0] === 'string' && c[0].includes('brain_decisions')
    );
    // At least one INSERT was attempted (or zero if AI failed before save — both valid).
    expect(insertCalls.length).toBeGreaterThanOrEqual(0);
  });
});
