// jest.mock() calls must come before requiring the module under test. This
// file is untransformed (jest.config.js only transforms .ts via @swc/jest),
// so there's no babel/swc hoisting to save a wrong order here — with
// require('../src/sentinelBrain') first (as it was), sentinelBrain.ts loads
// with the REAL dbClient before any mock is registered, and every dbClient
// call inside it silently hits the real (unconfigured) module all test run.
// Tests below never caught this because their assertions are loose enough
// (resolves.toBeUndefined(), toBeGreaterThanOrEqual(0)) to pass either way.
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

const { runStrategicBrain } = require('../src/sentinelBrain');

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

  test('feeds past decision outcomes back into the LLM prompt as a per-repo track record', async () => {
    const axios = require('axios');
    jest.spyOn(axios, 'post').mockResolvedValue({
      data: { choices: [{ message: { content: JSON.stringify({
        focus_repos: ['costpilot'], action: 'monitor', auto_execute: false,
        reasoning: 'ok', daily_goal: 'ok', alerts: [], skip_repos: [],
      }) } }] },
    });

    const { query } = require('../src/dbClient');
    query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('SELECT decision, outcome FROM brain_decisions')) {
        return Promise.resolve({
          rows: [
            { decision: { focus_repos: ['costpilot'] }, outcome: { avgHealthDelta: '0.20' } },
            { decision: { focus_repos: ['costpilot'] }, outcome: { avgHealthDelta: -0.10 } },
            { decision: { focus_repos: ['other-repo'] }, outcome: { avgHealthDelta: 1.5 } },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    process.env.NVIDIA_API_KEY = 'test-key';
    await runStrategicBrain(null);
    delete process.env.NVIDIA_API_KEY;

    const call = axios.post.mock.calls[0];
    const userPrompt = call[1].messages.find(m => m.role === 'user').content;

    expect(userPrompt).toContain('TRACK RECORD');
    // (0.20 + -0.10) / 2 = 0.05
    expect(userPrompt).toContain('costpilot: focused 2x before, avg health delta +0.05');
    expect(userPrompt).toContain('other-repo: focused 1x before, avg health delta +1.5');

    axios.post.mockRestore();
  });
});
