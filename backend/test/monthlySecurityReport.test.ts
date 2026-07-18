const sendTelegramMessageMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/telegramClient', () => ({
  sendTelegramMessage: (...a: any[]) => sendTelegramMessageMock(...a),
}));

const getPortfolioSecuritySummaryMock = jest.fn();
const getIssuesFoundSinceMock = jest.fn();
const getIssuesResolvedSinceMock = jest.fn();
jest.mock('../src/securityDb', () => ({
  getPortfolioSecuritySummary: () => getPortfolioSecuritySummaryMock(),
  getIssuesFoundSince: (days: number) => getIssuesFoundSinceMock(days),
  getIssuesResolvedSince: (days: number) => getIssuesResolvedSinceMock(days),
}));

import { generateMonthlySecurityReport } from '../src/monthlySecurityReport';

describe('generateMonthlySecurityReport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('skips sending when there is no security data at all', async () => {
    getPortfolioSecuritySummaryMock.mockResolvedValue([]);
    getIssuesFoundSinceMock.mockResolvedValue([]);
    getIssuesResolvedSinceMock.mockResolvedValue(0);

    await generateMonthlySecurityReport();

    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });

  it('sends a report with severity breakdown and portfolio average', async () => {
    getPortfolioSecuritySummaryMock.mockResolvedValue([
      { repo_name: 'repo-a', score: '8.5', critical_count: 0, high_count: 1 },
      { repo_name: 'repo-b', score: '4.0', critical_count: 2, high_count: 3 },
    ]);
    getIssuesFoundSinceMock.mockResolvedValue([
      { severity: 'critical', count: 2 },
      { severity: 'high', count: 3 },
    ]);
    getIssuesResolvedSinceMock.mockResolvedValue(4);

    await generateMonthlySecurityReport();

    expect(sendTelegramMessageMock).toHaveBeenCalledTimes(1);
    const [message] = sendTelegramMessageMock.mock.calls[0];
    expect(message).toContain('Monthly Security Report');
    expect(message).toContain('New issues found (last 30 days): 5');
    expect(message).toContain('critical: 2');
    expect(message).toContain('high: 3');
    expect(message).toContain('Issues resolved (last 30 days): 4');
    expect(message).toContain('Portfolio average score: 6.3/10 across 2 repo(s)');
    expect(message).toContain('repo-b: 4.0/10 (2 critical, 3 high)');
  });

  it('omits the "needs attention" section when no repo has critical/high issues', async () => {
    getPortfolioSecuritySummaryMock.mockResolvedValue([
      { repo_name: 'repo-a', score: '9.0', critical_count: 0, high_count: 0 },
    ]);
    getIssuesFoundSinceMock.mockResolvedValue([]);
    getIssuesResolvedSinceMock.mockResolvedValue(0);

    await generateMonthlySecurityReport();

    const [message] = sendTelegramMessageMock.mock.calls[0];
    expect(message).not.toContain('Repos needing attention');
  });

  it('logs and does not throw when the DB query fails', async () => {
    getPortfolioSecuritySummaryMock.mockRejectedValue(new Error('db down'));
    getIssuesFoundSinceMock.mockResolvedValue([]);
    getIssuesResolvedSinceMock.mockResolvedValue(0);

    await expect(generateMonthlySecurityReport()).resolves.toBeUndefined();
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });
});
