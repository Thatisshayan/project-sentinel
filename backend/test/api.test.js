process.env.SENTINEL_UI_KEY = '';

jest.mock('../src/dbClient', () => ({
  query: jest.fn(),
}));

const { query }  = require('../src/dbClient');
const request    = require('supertest');
const express    = require('express');
const apiRouter  = require('../src/api');

const app = express();
app.use(express.json());
app.use('/api', apiRouter);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/portfolio', () => {
  function mockPortfolioQueries({ securityScore = 85, monthlyCost = '12.50', queued = '2', healthDelta = null } = {}) {
    query
      .mockResolvedValueOnce({ rows: [{
        repo_name:      'tapcash',
        repo_full_name: 'your-org/tapcash',
        health_score:   8.0,
        build_status:   'passing',
        priority:       'critical',
        tasks_queued:   parseInt(queued),
        last_commit_at: null,
        last_build_at:  null,
        recorded_at:    new Date().toISOString(),
        security_score: securityScore,
      }] })
      .mockResolvedValueOnce({ rows: [] })                                 // agents
      .mockResolvedValueOnce({ rows: [{ monthly_cost: monthlyCost }] })    // cost
      .mockResolvedValueOnce({ rows: [{ queued }] })                       // tasks
      .mockResolvedValueOnce({ rows: healthDelta != null ? [{ health_delta: healthDelta }] : [] }); // velocity
  }

  it('includes security_score per repo', async () => {
    mockPortfolioQueries({ securityScore: 85 });
    const res = await request(app).get('/api/portfolio');
    expect(res.status).toBe(200);
    expect(res.body.repos).toHaveLength(1);
    expect(res.body.repos[0]).toHaveProperty('security_score');
    expect(res.body.repos[0].security_score).toBe(85);
  });

  it('returns security_score 0 when no security data exists', async () => {
    mockPortfolioQueries({ securityScore: 0 });
    const res = await request(app).get('/api/portfolio');
    expect(res.status).toBe(200);
    expect(res.body.repos[0].security_score).toBe(0);
  });

  it('returns healthDelta from velocity_metrics', async () => {
    mockPortfolioQueries({ healthDelta: 1.5 });
    const res = await request(app).get('/api/portfolio');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('healthDelta', 1.5);
  });

  it('returns healthDelta null when no velocity data', async () => {
    mockPortfolioQueries({ healthDelta: null });
    const res = await request(app).get('/api/portfolio');
    expect(res.status).toBe(200);
    expect(res.body.healthDelta).toBeNull();
  });
});

describe('API auth middleware', () => {
  const protectedApp = express();
  protectedApp.use(express.json());
  protectedApp.use('/api', apiRouter);

  afterEach(() => {
    delete process.env.SENTINEL_UI_KEY;
  });

  it('returns 401 when SENTINEL_UI_KEY is set and header is missing', async () => {
    process.env.SENTINEL_UI_KEY = 'secret-key';
    const res = await request(protectedApp).get('/api/portfolio');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error', 'Unauthorized');
  });

  it('returns 401 when SENTINEL_UI_KEY is set and header is wrong', async () => {
    process.env.SENTINEL_UI_KEY = 'secret-key';
    const res = await request(protectedApp).get('/api/portfolio').set('x-sentinel-key', 'wrong');
    expect(res.status).toBe(401);
  });

  it('passes through when correct x-sentinel-key is provided', async () => {
    process.env.SENTINEL_UI_KEY = 'secret-key';
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ monthly_cost: '0' }] })
      .mockResolvedValueOnce({ rows: [{ queued: '0' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(protectedApp).get('/api/portfolio').set('x-sentinel-key', 'secret-key');
    expect(res.status).toBe(200);
  });

  it('passes through when SENTINEL_UI_KEY is not set (open mode)', async () => {
    process.env.SENTINEL_UI_KEY = '';
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ monthly_cost: '0' }] })
      .mockResolvedValueOnce({ rows: [{ queued: '0' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(protectedApp).get('/api/portfolio');
    expect(res.status).toBe(200);
  });
});
