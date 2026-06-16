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
  it('includes security_score per repo', async () => {
    query
      .mockResolvedValueOnce({ rows: [{
        repo_name:      'tapcash',
        repo_full_name: 'Thatisshayan/tapcash',
        health_score:   8.0,
        build_status:   'passing',
        priority:       'critical',
        tasks_queued:   2,
        last_commit_at: null,
        last_build_at:  null,
        recorded_at:    new Date().toISOString(),
        security_score: 85,
      }] })
      .mockResolvedValueOnce({ rows: [] })   // agents
      .mockResolvedValueOnce({ rows: [{ monthly_cost: '12.50' }] })  // cost
      .mockResolvedValueOnce({ rows: [{ queued: '2' }] });           // tasks

    const res = await request(app).get('/api/portfolio');
    expect(res.status).toBe(200);
    expect(res.body.repos).toHaveLength(1);
    expect(res.body.repos[0]).toHaveProperty('security_score');
    expect(res.body.repos[0].security_score).toBe(85);
  });

  it('returns security_score 0 when no security data exists', async () => {
    query
      .mockResolvedValueOnce({ rows: [{
        repo_name:      'tapcash',
        repo_full_name: 'Thatisshayan/tapcash',
        health_score:   7.0,
        build_status:   'passing',
        priority:       'critical',
        tasks_queued:   0,
        last_commit_at: null,
        last_build_at:  null,
        recorded_at:    new Date().toISOString(),
        security_score: 0,  // COALESCE(ss.score, 0) when no security row exists
      }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ monthly_cost: '0' }] })
      .mockResolvedValueOnce({ rows: [{ queued: '0' }] });

    const res = await request(app).get('/api/portfolio');
    expect(res.status).toBe(200);
    const repo = res.body.repos[0];
    expect(repo).toHaveProperty('security_score');
    expect(repo.security_score).toBe(0);
  });
});
