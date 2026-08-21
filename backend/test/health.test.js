jest.mock('../src/dbClient', () => ({
  query: jest.fn(),
}));

jest.mock('../src/queueClient', () => ({
  getRedisConnection: jest.fn(),
  getBuildPollQueue: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const { query } = require('../src/dbClient');
const { getRedisConnection, getBuildPollQueue } = require('../src/queueClient');
const { healthCheck, readinessCheck } = require('../src/health');
const { markRuntimeBooting, markRuntimeReady, markRuntimeFailed } = require('../src/runtimeState');

function buildApp() {
  const app = express();
  app.get('/health', healthCheck);
  app.get('/ready', readinessCheck);
  return app;
}

describe('health and readiness routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TELEGRAM_BOT_TOKEN = 'token';
    process.env.TELEGRAM_CHAT_ID = 'chat';
    process.env.NOTION_API_KEY = 'notion';
    process.env.NOTION_DATABASE_ID = 'db';
    markRuntimeReady();
  });

  it('returns 200 from /health even when dependencies are degraded', async () => {
    query
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ rows: [{ awaiting_approval: '0', executing: '0', completed_7d: '0' }] });
    getRedisConnection.mockImplementation(() => ({ ping: jest.fn().mockRejectedValue(new Error('redis down')) }));
    getBuildPollQueue.mockImplementation(() => ({ getJobCounts: jest.fn().mockResolvedValue({ waiting: 0 }) }));

    const app = buildApp();
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.services.database).toBe('error');
    expect(res.body.services.redis).toBe('error');
  });

  it('returns 503 from /ready while runtime is booting', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ awaiting_approval: '0', executing: '0', completed_7d: '0' }] });
    getRedisConnection.mockImplementation(() => ({ ping: jest.fn().mockResolvedValue('PONG') }));
    getBuildPollQueue.mockImplementation(() => ({ getJobCounts: jest.fn().mockResolvedValue({ waiting: 0 }) }));
    markRuntimeBooting();

    const app = buildApp();
    const res = await request(app).get('/ready');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('not_ready');
    expect(res.body.blockedBy).toBe('runtime_booting');
  });

  it('returns 503 from /ready when database is unavailable', async () => {
    query
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ rows: [{ awaiting_approval: '0', executing: '0', completed_7d: '0' }] });
    getRedisConnection.mockImplementation(() => ({ ping: jest.fn().mockResolvedValue('PONG') }));
    getBuildPollQueue.mockImplementation(() => ({ getJobCounts: jest.fn().mockResolvedValue({ waiting: 0 }) }));

    const app = buildApp();
    const res = await request(app).get('/ready');

    expect(res.status).toBe(503);
    expect(res.body.blockedBy).toBe('database_unavailable');
  });

  it('returns 200 from /ready when runtime and critical dependencies are healthy', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ awaiting_approval: '0', executing: '0', completed_7d: '0' }] });
    getRedisConnection.mockImplementation(() => ({ ping: jest.fn().mockResolvedValue('PONG') }));
    getBuildPollQueue.mockImplementation(() => ({ getJobCounts: jest.fn().mockResolvedValue({ waiting: 0, active: 0, delayed: 0 }) }));
    markRuntimeReady();

    const app = buildApp();
    const res = await request(app).get('/ready');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });

  it('returns runtime failure details from /ready after bootstrap failure', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ awaiting_approval: '0', executing: '0', completed_7d: '0' }] });
    getRedisConnection.mockImplementation(() => ({ ping: jest.fn().mockResolvedValue('PONG') }));
    getBuildPollQueue.mockImplementation(() => ({ getJobCounts: jest.fn().mockResolvedValue({ waiting: 0 }) }));
    markRuntimeFailed('bootstrap exploded');

    const app = buildApp();
    const res = await request(app).get('/ready');

    expect(res.status).toBe(503);
    expect(res.body.blockedBy).toBe('runtime_failed:bootstrap exploded');
  });
});
