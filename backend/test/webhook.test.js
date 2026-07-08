process.env.GITHUB_WEBHOOK_SECRET = 'test-secret-for-jest';
process.env.NOTION_API_KEY        = 'test-notion-key';
process.env.NOTION_DATABASE_ID    = 'test-db-id';
process.env.TELEGRAM_BOT_TOKEN    = 'test-tg-token';
process.env.TELEGRAM_CHAT_ID      = '-100123456789';

jest.mock('../src/notionClient', () => ({
  findNotionProject:  jest.fn(),
  updateNotionProject: jest.fn(),
  appendChangelog:    jest.fn(),
}));

jest.mock('../src/dbClient', () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
}));

jest.mock('../src/auditTaskWriter', () => ({
  updateNotionTaskStatus: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/queueClient', () => ({
  enqueueBuildCheck: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@notionhq/client', () => ({
  Client: jest.fn().mockImplementation(() => ({
    databases: { query: jest.fn().mockResolvedValue({ results: [], has_more: false }) },
  })),
}));

jest.mock('../src/telegramClient', () => ({
  sendTelegramMessage: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/portfolioDb', () => ({
  upsertRepoMetrics: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/deduplication', () => ({
  isAlreadyProcessed: jest.fn().mockResolvedValue(false),
  markAsProcessed:    jest.fn().mockResolvedValue(undefined),
}));

const crypto    = require('crypto');
const request   = require('supertest');
const express   = require('express');

const webhookRouter                     = require('../src/webhook');
const { findNotionProject,
        updateNotionProject }           = require('../src/notionClient');
const { sendTelegramMessage }           = require('../src/telegramClient');
const { isAlreadyProcessed,
        markAsProcessed }               = require('../src/deduplication');
const { upsertRepoMetrics }             = require('../src/portfolioDb');

const app = express();
app.use(express.json());
app.use('/webhook', webhookRouter);

const payload = {
  ref: 'refs/heads/main',
  repository: {
    name: 'tapcash',
    full_name: 'your-org/tapcash',
    html_url: 'https://github.com/your-org/tapcash',
  },
  head_commit: {
    id: 'deadbeef1234567890deadbeef1234567890dead',
    message: 'test: verify phase 1',
    url: 'https://github.com/commit/deadbeef',
    author: { name: 'Test User' },
    timestamp: '2026-06-10T09:00:00Z',
    added: ['src/utils.js'],
    modified: [],
    removed: [],
  },
  pusher: { name: 'Test User' },
};

function sign(body) {
  return 'sha256=' + crypto
    .createHmac('sha256', 'test-secret-for-jest')
    .update(JSON.stringify(body))
    .digest('hex');
}

beforeEach(() => {
  jest.clearAllMocks();
  findNotionProject.mockResolvedValue({
    pageId:      'page-abc-123',
    projectName: 'TapCash',
    url:         'https://notion.so/tapcash',
  });
  updateNotionProject.mockResolvedValue(undefined);
  isAlreadyProcessed.mockResolvedValue(false);
  markAsProcessed.mockResolvedValue(undefined);
  sendTelegramMessage.mockResolvedValue(true);
  upsertRepoMetrics.mockResolvedValue(undefined);
});

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const waitLong = () => wait(600);

describe('POST /webhook/github', () => {
  test('returns 200 immediately for valid signed payload', async () => {
    const res = await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(payload))
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  test('returns 401 when signature header is missing', async () => {
    const res = await request(app).post('/webhook/github').send(payload);
    expect(res.status).toBe(401);
  });

  test('returns 401 for wrong signature', async () => {
    const res = await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', 'sha256=wrongsignature')
      .send(payload);
    expect(res.status).toBe(401);
  });

  test('calls findNotionProject with lowercased repo name', async () => {
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(payload))
      .send(payload);
    await wait(200);
    expect(findNotionProject).toHaveBeenCalledWith('tapcash');
  });

  test('calls updateNotionProject when project is found', async () => {
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(payload))
      .send(payload);
    await wait(200);
    expect(updateNotionProject).toHaveBeenCalledTimes(1);
  });

  test('sends success Telegram message when everything works', async () => {
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(payload))
      .send(payload);
    await wait(200);
    const msg = sendTelegramMessage.mock.calls[0][0];
    expect(msg).toContain('✅');
    expect(msg).toContain('tapcash');
  });

  test('sends unknown repo warning when no Notion match', async () => {
    findNotionProject.mockResolvedValue(null);
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(payload))
      .send(payload);
    await waitLong();
    const calls = sendTelegramMessage.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const msg = calls[0][0];
    expect(msg).toContain('Unknown repo received');
    expect(msg).toContain('tapcash');
  });

  test('skips duplicate commits', async () => {
    isAlreadyProcessed.mockResolvedValue(true);
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(payload))
      .send(payload);
    await wait(200);
    expect(updateNotionProject).not.toHaveBeenCalled();
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  test('records last_commit_at in portfolio_metrics after push', async () => {
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(payload))
      .send(payload);
    await wait(200);
    expect(upsertRepoMetrics).toHaveBeenCalledWith(
      expect.objectContaining({
        repoFullName: 'your-org/tapcash',
        repoName:     'tapcash',
        lastCommitAt: expect.any(Date),
      })
    );
  });

  test('sends error Telegram when Notion update throws', async () => {
    updateNotionProject.mockRejectedValue(new Error('Notion API 500'));
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(payload))
      .send(payload);
    await wait(200);
    const msg = sendTelegramMessage.mock.calls[0][0];
    expect(msg).toContain('❌');
    expect(msg).toContain('Notion update failed');
  });
});

describe('PR event handling (pull_request webhook)', () => {
  const { query } = require('../src/dbClient');

  const prPayload = {
    action: 'closed',
    pull_request: {
      number: 42,
      merged: true,
      html_url: 'https://github.com/your-org/tapcash/pull/42',
      head: { ref: 'sentinel/batch-1-tasks-1-5' },
      base: { ref: 'main' },
    },
    repository: { name: 'tapcash', full_name: 'your-org/tapcash' },
  };

  test('ignores pull_request events for non-sentinel branches', async () => {
    const humanPR = {
      ...prPayload,
      pull_request: { ...prPayload.pull_request, head: { ref: 'feature/dark-mode' } },
    };
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(humanPR))
      .set('x-github-event', 'pull_request')
      .send(humanPR);
    await wait(200);
    expect(query).not.toHaveBeenCalled();
  });

  test('marks tasks done when sentinel PR is merged', async () => {
    query.mockResolvedValue({ rows: [{ id: 1, notion_page_id: 'page-abc' }] });
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(prPayload))
      .set('x-github-event', 'pull_request')
      .send(prPayload);
    await waitLong();
    expect(query).toHaveBeenCalled();
    const sql = query.mock.calls[0][0];
    expect(sql).toContain("status = 'done'");
    const calls = sendTelegramMessage.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1][0]).toContain('PR Merged');
  });

  test('requeues tasks when sentinel PR is closed without merging', async () => {
    const rejected = {
      ...prPayload,
      pull_request: { ...prPayload.pull_request, merged: false },
    };
    query.mockResolvedValue({ rows: [{ id: 1 }] });
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(rejected))
      .set('x-github-event', 'pull_request')
      .send(rejected);
    await waitLong();
    expect(query).toHaveBeenCalled();
    const sql = query.mock.calls[0][0];
    expect(sql).toContain("status = 'queued'");
    const calls = sendTelegramMessage.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1][0]).toContain('PR Rejected');
  });
});
