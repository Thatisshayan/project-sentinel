process.env.GITHUB_TOKEN    = 'test-token';
process.env.VERCEL_TOKEN   = '';
process.env.RAILWAY_TOKEN  = '';

jest.mock('../src/dbClient', () => ({
  query: jest.fn().mockResolvedValue({ rows: [{ total: '2', last_build: null, failed_count: '0', done: '3', queued: '1' }] }),
}));

const { query } = require('../src/dbClient');

describe('refreshRepoMetrics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    query.mockResolvedValue({ rows: [{ total: '2', last_build: null, failed_count: '0', done: '3', queued: '1', status: 'resolved' }] });
  });

  it('is exported from portfolioAnalytics', () => {
    const analytics = require('../src/portfolioAnalytics');
    expect(typeof analytics.refreshRepoMetrics).toBe('function');
  });

  it('calls upsertRepoMetrics for the given repo after computing stats', async () => {
    const { refreshRepoMetrics } = require('../src/portfolioAnalytics');
    await refreshRepoMetrics('your-org/tapcash', 'tapcash');
    const insertCall = query.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO portfolio_metrics')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[1][0]).toBe('your-org/tapcash');
    expect(insertCall[1][1]).toBe('tapcash');
  });

  it('returns stats with healthScore and buildStatus', async () => {
    const { refreshRepoMetrics } = require('../src/portfolioAnalytics');
    const stats = await refreshRepoMetrics('your-org/tapcash', 'tapcash');
    expect(stats).toHaveProperty('healthScore');
    expect(stats).toHaveProperty('buildStatus');
  });
});
