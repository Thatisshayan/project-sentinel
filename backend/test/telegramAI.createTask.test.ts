const createAuditTaskMock = jest.fn().mockResolvedValue({ id: 1 });
const createAuditCycleMock = jest.fn().mockResolvedValue({ id: 10 });
const getActiveCycleForRepoMock = jest.fn().mockResolvedValue(null);

jest.mock('../src/auditDb', () => ({
  createAuditTask: (...a: any[]) => createAuditTaskMock(...a),
  createAuditCycle: (...a: any[]) => createAuditCycleMock(...a),
  getActiveCycleForRepo: (...a: any[]) => getActiveCycleForRepoMock(...a),
  stopAllTasksForRepo: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/repoResolver', () => ({
  canonicalizeRepoName: (input: string) => ({ repoName: input, repoFullName: `test-org/${input}` }),
  repoFullName: (r: string) => `test-org/${r}`,
}));

const sendTelegramMessageMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/telegramClient', () => ({
  sendTelegramMessage: (...a: any[]) => sendTelegramMessageMock(...a),
}));

jest.mock('../src/portfolioAnalytics', () => ({
  getPortfolioSummary: jest.fn().mockResolvedValue({ metrics: [], avgHealth: '5.0', healthy: [], broken: [] }),
  REPO_LIST: [{ repoName: 'tapcash', repoFullName: 'test-org/tapcash' }],
}));
jest.mock('../src/portfolioDb', () => ({
  getOpenPatterns: jest.fn().mockResolvedValue([]),
  getDailyCost: jest.fn().mockResolvedValue(0),
  getMonthlyCost: jest.fn().mockResolvedValue(0),
}));

import { __test__executeAction } from '../src/telegramAI';

/**
 * Regression guard: the create_task action previously called createAuditTask
 * with `estimatedComplexity` instead of the `complexity` field auditDb.ts
 * actually reads — since the require() is untyped, tsc never caught the
 * mismatch, and every chat-created task silently got complexity: NULL.
 */
describe('telegramAI create_task action', () => {
  beforeEach(() => jest.clearAllMocks());

  it('passes complexity (not estimatedComplexity) to createAuditTask', async () => {
    await __test__executeAction(
      { action: 'create_task', repo: 'tapcash', title: 'Add dark mode', description: 'desc', priority: 'medium' },
      null
    );

    expect(createAuditTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ complexity: 'medium' })
    );
    const callArg = createAuditTaskMock.mock.calls[0][0];
    expect(callArg.estimatedComplexity).toBeUndefined();
  });
});
