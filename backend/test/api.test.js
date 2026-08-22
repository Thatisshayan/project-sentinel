process.env.SENTINEL_UI_KEY = '';
process.env.GITHUB_ORG = 'your-org';

jest.mock('../src/dbClient', () => ({
  query: jest.fn(),
}));

jest.mock('../src/projectMemory', () => ({
  initMemorySchema: jest.fn(),
  getMemoryEntries: jest.fn(),
  addMemoryEntry: jest.fn(),
  deleteMemoryEntry: jest.fn(),
  getMemoryForPrompt: jest.fn(),
}));

jest.mock('../src/projectDb', () => ({
  getAspectState: jest.fn(),
  getRepoAutomationPolicy: jest.fn(),
  setRepoAutomationPolicy: jest.fn(),
}));

jest.mock('../src/governanceStatus', () => ({
  getGovernanceStatus: jest.fn(),
}));

const { query }  = require('../src/dbClient');
const projectMemory = require('../src/projectMemory');
const projectDb  = require('../src/projectDb');
const governanceStatus = require('../src/governanceStatus');
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

describe('GET /api/repo/:name', () => {
  it('includes the aspect field from projectDb.getAspectState', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ repo_name: 'tapcash', health_score: 8.0 }] }) // metrics
      .mockResolvedValueOnce({ rows: [] })                                            // tasks
      .mockResolvedValueOnce({ rows: [] });                                           // cycle
    projectDb.getAspectState.mockResolvedValueOnce({ aspect: 'security', sprintCount: 2 });
    projectDb.getRepoAutomationPolicy.mockResolvedValueOnce({
      allowTaskExecution: true,
      allowPrOpen: true,
      allowPrUpdate: true,
      allowAutoPush: true,
    });

    const res = await request(app).get('/api/repo/tapcash');
    expect(res.status).toBe(200);
    expect(res.body.aspect).toEqual({ aspect: 'security', sprintCount: 2 });
    expect(res.body.policy).toEqual({
      allowTaskExecution: true,
      allowPrOpen: true,
      allowPrUpdate: true,
      allowAutoPush: true,
    });
    expect(projectDb.getAspectState).toHaveBeenCalledWith('tapcash');
  });

  it('returns aspect: null when no aspect state exists yet', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ repo_name: 'tapcash', health_score: 8.0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    projectDb.getAspectState.mockResolvedValueOnce(null);
    projectDb.getRepoAutomationPolicy.mockResolvedValueOnce({
      allowTaskExecution: true,
      allowPrOpen: true,
      allowPrUpdate: true,
      allowAutoPush: true,
    });

    const res = await request(app).get('/api/repo/tapcash');
    expect(res.status).toBe(200);
    expect(res.body.aspect).toBeNull();
  });

  it('returns 400 for an invalid repo name', async () => {
    const res = await request(app).get('/api/repo/..%2Fetc');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/governance/status', () => {
  it('returns the governance snapshot from governanceStatus', async () => {
    governanceStatus.getGovernanceStatus.mockResolvedValueOnce({
      repoFullName: 'your-org/project-sentinel',
      branch: 'main',
      status: 'drift',
      branchProtectionConfigured: false,
      enforceAdmins: false,
      requirePullRequestReviews: false,
      dismissStaleReviews: false,
      requireUpToDateBranches: false,
      allowForcePushes: true,
      allowDeletions: true,
      requiredStatusChecks: [],
      missingRequiredChecks: ['gate'],
      drift: ['Branch protection is not configured on main.'],
    });

    const res = await request(app).get('/api/governance/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('drift');
    expect(res.body.repoFullName).toBe('your-org/project-sentinel');
    expect(res.body.drift).toContain('Branch protection is not configured on main.');
  });

  it('returns 500 when governance status lookup throws', async () => {
    governanceStatus.getGovernanceStatus.mockRejectedValueOnce(new Error('boom'));

    const res = await request(app).get('/api/governance/status');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('boom');
  });
});

describe('POST /api/repo/:name/policy', () => {
  it('updates repo automation policy for a valid repo name', async () => {
    projectDb.getRepoAutomationPolicy.mockResolvedValueOnce({
      allowTaskExecution: true,
      allowPrOpen: true,
      allowPrUpdate: true,
      allowAutoPush: true,
    });
    projectDb.setRepoAutomationPolicy.mockResolvedValueOnce({
      allowTaskExecution: false,
      allowPrOpen: true,
      allowPrUpdate: true,
      allowAutoPush: true,
    });

    const res = await request(app)
      .post('/api/repo/tapcash/policy')
      .send({ allowTaskExecution: false });

    expect(res.status).toBe(200);
    expect(res.body.allowTaskExecution).toBe(false);
    expect(projectDb.setRepoAutomationPolicy).toHaveBeenCalledWith('tapcash', {
      allowTaskExecution: false,
      allowPrOpen: true,
      allowPrUpdate: true,
      allowAutoPush: true,
    });
  });

  it('returns 400 for an unknown policy field', async () => {
    const res = await request(app)
      .post('/api/repo/tapcash/policy')
      .send({ noSuchField: true });

    expect(res.status).toBe(400);
  });

  it('returns 400 for non-boolean values', async () => {
    const res = await request(app)
      .post('/api/repo/tapcash/policy')
      .send({ allowTaskExecution: 'yes' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/repo/:name/memory', () => {
  it('returns memory entries for a valid repo name', async () => {
    const entries = [{ id: 1, repo_full_name: 'your-org/tapcash', type: 'note', content: 'x', added_by: null, created_at: '2026-01-01' }];
    projectMemory.getMemoryEntries.mockResolvedValueOnce(entries);

    const res = await request(app).get('/api/repo/tapcash/memory');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(entries);
    expect(projectMemory.getMemoryEntries).toHaveBeenCalledWith('your-org/tapcash', 200);
  });

  it('returns 400 for an invalid repo name', async () => {
    const res = await request(app).get('/api/repo/bad name/memory');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/repo/:name/memory', () => {
  it('adds a memory entry on the happy path', async () => {
    const entry = { id: 5, repo_full_name: 'your-org/tapcash', type: 'convention', content: 'Use tabs', added_by: 'Dashboard', created_at: '2026-01-01' };
    projectMemory.addMemoryEntry.mockResolvedValueOnce(entry);

    const res = await request(app).post('/api/repo/tapcash/memory').send({ type: 'convention', content: 'Use tabs' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(entry);
    expect(projectMemory.addMemoryEntry).toHaveBeenCalledWith('your-org/tapcash', 'convention', 'Use tabs', 'Dashboard');
  });

  it('returns 400 for an invalid type', async () => {
    const res = await request(app).post('/api/repo/tapcash/memory').send({ type: 'bogus', content: 'x' });
    expect(res.status).toBe(400);
    expect(projectMemory.addMemoryEntry).not.toHaveBeenCalled();
  });

  it('returns 400 for empty content', async () => {
    const res = await request(app).post('/api/repo/tapcash/memory').send({ type: 'note', content: '   ' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for content over the length limit', async () => {
    const res = await request(app).post('/api/repo/tapcash/memory').send({ type: 'note', content: 'x'.repeat(2001) });
    expect(res.status).toBe(400);
    expect(projectMemory.addMemoryEntry).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid repo name', async () => {
    const res = await request(app).post('/api/repo/bad name/memory').send({ type: 'note', content: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/repo/:name/memory/:id', () => {
  it('deletes an existing entry', async () => {
    projectMemory.deleteMemoryEntry.mockResolvedValueOnce(true);
    const res = await request(app).delete('/api/repo/tapcash/memory/5');
    expect(res.status).toBe(200);
    expect(projectMemory.deleteMemoryEntry).toHaveBeenCalledWith('your-org/tapcash', 5);
  });

  it('returns 404 when the entry does not exist', async () => {
    projectMemory.deleteMemoryEntry.mockResolvedValueOnce(false);
    const res = await request(app).delete('/api/repo/tapcash/memory/999');
    expect(res.status).toBe(404);
  });

  it('returns 400 for a non-integer id', async () => {
    const res = await request(app).delete('/api/repo/tapcash/memory/not-a-number');
    expect(res.status).toBe(400);
    expect(projectMemory.deleteMemoryEntry).not.toHaveBeenCalled();
  });
});
