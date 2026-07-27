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
  resolveDebugAttemptByPr: jest.fn().mockResolvedValue(null),
}));

jest.mock('../src/securityDb', () => ({
  resolveIssuesByPr: jest.fn().mockResolvedValue(0),
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
  claimProcessing:    jest.fn().mockResolvedValue(true),
  markAsProcessed:    jest.fn().mockResolvedValue(undefined),
  unmarkProcessed:    jest.fn().mockResolvedValue(undefined),
}));

const crypto    = require('crypto');
const request   = require('supertest');
const express   = require('express');

const webhookRouter                     = require('../src/webhook');
const { findNotionProject,
        updateNotionProject }           = require('../src/notionClient');
const { sendTelegramMessage }           = require('../src/telegramClient');
const { claimProcessing,
        unmarkProcessed }               = require('../src/deduplication');
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
  claimProcessing.mockResolvedValue(true);
  unmarkProcessed.mockResolvedValue(undefined);
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
    expect(msg).toContain('New repo pushed');
    expect(msg).toContain('tapcash');
    expect(msg).toContain('/sentinel repos scan');
    expect(msg).toContain('nothing was lost');
    expect(msg).toContain('Branch: main');
    expect(msg).toContain('test: verify phase 1');
  });

  test('skips duplicate commits', async () => {
    claimProcessing.mockResolvedValue(false);
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

  test('releases the processed-claim when Notion update fails — a webhook redelivery must be able to retry', async () => {
    // Claimed immediately (before Notion) to close the redelivery race
    // window, then released on this specific failure path — net effect is
    // still "not processed," just via claim+release instead of never-claim.
    updateNotionProject.mockRejectedValue(new Error('Notion API 500'));
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(payload))
      .send(payload);
    await wait(200);
    expect(claimProcessing).toHaveBeenCalledWith('tapcash', payload.head_commit.id);
    expect(unmarkProcessed).toHaveBeenCalledWith('tapcash', payload.head_commit.id);
  });

  test('DOES leave the commit marked as processed when Notion update succeeds (regression guard against re-breaking dedup)', async () => {
    updateNotionProject.mockResolvedValue(undefined);
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(payload))
      .send(payload);
    await wait(200);
    expect(claimProcessing).toHaveBeenCalledWith('tapcash', payload.head_commit.id);
    expect(unmarkProcessed).not.toHaveBeenCalled();
  });

  test('DOES leave the commit marked as processed for an unknown-repo push, so the warning is not resent on every redelivery', async () => {
    findNotionProject.mockResolvedValue(null);
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(payload))
      .send(payload);
    await wait(200);
    expect(claimProcessing).toHaveBeenCalledWith('tapcash', payload.head_commit.id);
    expect(unmarkProcessed).not.toHaveBeenCalled();
  });

  test('releases the processed-claim when the Notion search itself throws', async () => {
    findNotionProject.mockRejectedValue(new Error('Notion API 500'));
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(payload))
      .send(payload);
    await wait(200);
    expect(claimProcessing).toHaveBeenCalledWith('tapcash', payload.head_commit.id);
    expect(unmarkProcessed).toHaveBeenCalledWith('tapcash', payload.head_commit.id);
  });

  test('does NOT release the claim for a permanent Notion error (bad auth) — a redelivery retry cannot fix that anyway', async () => {
    const permanentErr = new Error('API token is invalid.');
    permanentErr.code = 'unauthorized';
    findNotionProject.mockRejectedValue(permanentErr);
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(payload))
      .send(payload);
    await wait(200);
    expect(claimProcessing).toHaveBeenCalledWith('tapcash', payload.head_commit.id);
    expect(unmarkProcessed).not.toHaveBeenCalled();
  });

  test('claims the commit as processed before the Notion search runs — closes the redelivery race window', async () => {
    // The whole point of today's fix: a near-simultaneous redelivery arriving
    // while the first request is still awaiting Notion must see the claim
    // already in place, not slip through and reprocess everything twice.
    // Verified via call order (not a mid-flight timing race, which proved
    // flaky in this test environment) — deterministic regardless of how
    // long the Notion call actually takes.
    const callOrder = [];
    claimProcessing.mockImplementation(async () => { callOrder.push('claimProcessing'); return true; });
    findNotionProject.mockImplementation(async () => {
      callOrder.push('findNotionProject');
      return { pageId: 'page-abc-123', projectName: 'TapCash', url: 'https://notion.so/tapcash' };
    });

    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(payload))
      .send(payload);
    await wait(200);

    expect(callOrder).toEqual(['claimProcessing', 'findNotionProject']);
  });
});

describe('PR event handling (pull_request webhook)', () => {
  const { query, resolveDebugAttemptByPr } = require('../src/dbClient');
  const { resolveIssuesByPr } = require('../src/securityDb');

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

  test('resolves security issues when a sentinel/security-patch- PR merges', async () => {
    resolveIssuesByPr.mockClear();
    query.mockResolvedValue({ rows: [] });
    const securityPatchPR = {
      ...prPayload,
      pull_request: {
        ...prPayload.pull_request,
        head: { ref: 'sentinel/security-patch-1234567890' },
        html_url: 'https://github.com/your-org/tapcash/pull/99',
      },
    };
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(securityPatchPR))
      .set('x-github-event', 'pull_request')
      .send(securityPatchPR);
    await waitLong();
    expect(resolveIssuesByPr).toHaveBeenCalledWith(
      'your-org/tapcash',
      'https://github.com/your-org/tapcash/pull/99'
    );
  });

  test('does NOT try to resolve security issues for a non-security-patch sentinel branch', async () => {
    resolveIssuesByPr.mockClear();
    query.mockResolvedValue({ rows: [] });
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(prPayload))
      .set('x-github-event', 'pull_request')
      .send(prPayload);
    await waitLong();
    expect(resolveIssuesByPr).not.toHaveBeenCalled();
  });

  test('resolves a debug attempt when a sentinel/fix- PR merges', async () => {
    resolveDebugAttemptByPr.mockClear();
    query.mockResolvedValue({ rows: [] });
    const debugFixPR = {
      ...prPayload,
      pull_request: {
        ...prPayload.pull_request,
        head: { ref: 'sentinel/fix-1-1234567890' },
        html_url: 'https://github.com/your-org/tapcash/pull/100',
      },
    };
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(debugFixPR))
      .set('x-github-event', 'pull_request')
      .send(debugFixPR);
    await waitLong();
    expect(resolveDebugAttemptByPr).toHaveBeenCalledWith(
      'your-org/tapcash',
      'https://github.com/your-org/tapcash/pull/100'
    );
  });

  test('does NOT try to resolve a debug attempt for a non-fix sentinel branch', async () => {
    resolveDebugAttemptByPr.mockClear();
    query.mockResolvedValue({ rows: [] });
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(prPayload))
      .set('x-github-event', 'pull_request')
      .send(prPayload);
    await waitLong();
    expect(resolveDebugAttemptByPr).not.toHaveBeenCalled();
  });

  test('does not attempt security/debug resolution when the PR is closed without merging, even on matching branches', async () => {
    resolveIssuesByPr.mockClear();
    resolveDebugAttemptByPr.mockClear();
    query.mockResolvedValue({ rows: [] });
    const rejectedSecurityPatch = {
      ...prPayload,
      pull_request: {
        ...prPayload.pull_request,
        merged: false,
        head: { ref: 'sentinel/security-patch-1234567890' },
      },
    };
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(rejectedSecurityPatch))
      .set('x-github-event', 'pull_request')
      .send(rejectedSecurityPatch);
    await waitLong();
    expect(resolveIssuesByPr).not.toHaveBeenCalled();
    expect(resolveDebugAttemptByPr).not.toHaveBeenCalled();
  });
});
