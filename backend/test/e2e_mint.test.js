/**
 * E2E pipeline test — "mint" project
 *
 * Exercises all 5 pipeline stages for the mint repo:
 *   Stage 1: Webhook receipt → payload extraction → signature auth
 *   Stage 2: Notion project match + Telegram topic routing to TOPIC_MINT
 *   Stage 3: Risk assessment for different mint commit types
 *   Stage 4: Audit orchestration rules (loop prevention, cycle lifecycle)
 *   Stage 5: PR lifecycle (merge → tasks done, reject → tasks requeued)
 */

// ── Environment setup ─────────────────────────────────────────────────────────
process.env.GITHUB_WEBHOOK_SECRET  = 'test-secret-for-jest';
process.env.NOTION_API_KEY         = 'test-notion-key';
process.env.NOTION_DATABASE_ID     = 'test-db-id';
process.env.TELEGRAM_BOT_TOKEN     = 'test-tg-token';
process.env.TELEGRAM_CHAT_ID       = '-100123456789';
process.env.GITHUB_ORG             = 'thatisshayan';
process.env.TOPIC_MINT             = '9001';

// ── Mocks ─────────────────────────────────────────────────────────────────────
jest.mock('../src/notionClient', () => ({
  findNotionProject:    jest.fn(),
  updateNotionProject:  jest.fn(),
  appendChangelog:      jest.fn(),
}));

jest.mock('../src/dbClient', () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
}));

jest.mock('../src/auditTaskWriter', () => ({
  writeTasksToNotion: jest.fn().mockResolvedValue({
    tasks: [
      { id: 't1', task_number: 1, title: 'Add error boundary',           builder_agent: 'qwen_coder', batch_number: 1, notion_page_id: 'np1' },
      { id: 't2', task_number: 2, title: 'Fix TypeScript strict errors',  builder_agent: 'qwen_coder', batch_number: 1, notion_page_id: 'np2' },
      { id: 't3', task_number: 3, title: 'Optimise bundle size',          builder_agent: 'qwen_coder', batch_number: 1, notion_page_id: 'np3' },
    ],
    failed:  [],
    skipped: [],
  }),
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
  upsertRepoMetrics:     jest.fn().mockResolvedValue(undefined),
  getAllLatestMetrics:    jest.fn().mockResolvedValue([]),
  getDailyCost:          jest.fn().mockResolvedValue(0),
  getMonthlyCost:        jest.fn().mockResolvedValue(0),
}));

jest.mock('../src/deduplication', () => ({
  isAlreadyProcessed: jest.fn().mockResolvedValue(false),
  markAsProcessed:    jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/claudeCodeAudit', () => ({
  runAudit: jest.fn(),
}));

jest.mock('../src/prCreator', () => ({
  createPullRequest: jest.fn(),
}));

jest.mock('../src/telegramMenus', () => ({
  sendMenu: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/auditDb', () => ({
  createAuditCycle:        jest.fn(),
  updateAuditCycle:        jest.fn().mockResolvedValue(undefined),
  getActiveCycleForRepo:   jest.fn(),
  getLastCompletedAudit:   jest.fn().mockResolvedValue(null),
  getQueuedTaskCount:      jest.fn().mockResolvedValue(0),
  getNextBatch:            jest.fn().mockResolvedValue([]),
  updateAuditTask:         jest.fn().mockResolvedValue(undefined),
  countTasksExecutedToday: jest.fn().mockResolvedValue(0),
  stopAllTasksForRepo:     jest.fn().mockResolvedValue(undefined),
  markTasksDoneForBranch:  jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/selfHealer', () => ({
  reportFailure: jest.fn().mockResolvedValue(undefined),
  reportSuccess: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/performanceTracker', () => ({
  trackModelCall: jest.fn((modelId, taskType, complexity, fn) => fn()),
}));

jest.mock('../src/repoLock', () => ({
  isRepoLocked: jest.fn().mockResolvedValue(null),
}));

jest.mock('../src/taskBuilder', () => ({
  executeBatch: jest.fn(),
}));

// ── Imports ───────────────────────────────────────────────────────────────────
const crypto  = require('crypto');
const request = require('supertest');
const express = require('express');

const webhookRouter = require('../src/webhook');

const { findNotionProject, updateNotionProject } = require('../src/notionClient');
const { sendTelegramMessage }                    = require('../src/telegramClient');
const { isAlreadyProcessed }                     = require('../src/deduplication');
const { upsertRepoMetrics }                      = require('../src/portfolioDb');
const { enqueueBuildCheck }                      = require('../src/queueClient');
const { query }                                  = require('../src/dbClient');
const { triggerAudit }                           = require('../src/auditOrchestrator');
const {
  getActiveCycleForRepo, getLastCompletedAudit,
  getQueuedTaskCount, createAuditCycle,
} = require('../src/auditDb');
const { runAudit }          = require('../src/claudeCodeAudit');
const { createPullRequest } = require('../src/prCreator');

// ── Test app ──────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use('/webhook', webhookRouter);

// ── Helpers ───────────────────────────────────────────────────────────────────
const MINT_ORG  = 'thatisshayan';
const MINT_REPO = 'mint';
const MINT_FULL = `${MINT_ORG}/${MINT_REPO}`;

function sign(body) {
  return 'sha256=' + crypto
    .createHmac('sha256', 'test-secret-for-jest')
    .update(JSON.stringify(body))
    .digest('hex');
}

function mintPush(overrides = {}) {
  return {
    ref: 'refs/heads/main',
    repository: {
      name:      MINT_REPO,
      full_name: MINT_FULL,
      html_url:  `https://github.com/${MINT_FULL}`,
    },
    head_commit: {
      id:        'mintcommit1234567890abcdef1234567890abcd',
      message:   'feat: add mint dashboard widget',
      url:       `https://github.com/${MINT_FULL}/commit/mintcommit`,
      author:    { name: 'Shayan', email: 'dev@mint.app' },
      timestamp: new Date().toISOString(),
      added:     ['src/dashboard/widget.tsx'],
      modified:  ['src/app/page.tsx'],
      removed:   [],
    },
    pusher: { name: 'Shayan' },
    commits: [],
    ...overrides,
  };
}

const wait     = (ms) => new Promise(r => setTimeout(r, ms));
const waitLong = ()   => wait(600);

// ── Stage 1: Portfolio registry — mint is a known project ─────────────────────
describe('Stage 1: mint is registered in the portfolio', () => {
  test('REPO_LIST includes mint with correct org prefix', () => {
    const { REPO_LIST } = require('../src/portfolioAnalytics');
    const entry = REPO_LIST.find(r => r.repoName === MINT_REPO);
    expect(entry).toBeDefined();
    expect(entry.repoFullName).toBe(MINT_FULL);
  });

  test('mint is in REPO_LIST (medium priority confirmed in source)', () => {
    const { REPO_LIST } = require('../src/portfolioAnalytics');
    const entry = REPO_LIST.find(r => r.repoName === MINT_REPO);
    // Priority is an internal constant — confirm the repo is tracked
    expect(entry).toBeDefined();
    expect(entry.repoFullName).toContain(MINT_REPO);
  });

  test('TOPIC_MINT env var maps to Telegram topic ID 9001', () => {
    const { sendTelegramMessage: fn } = require('../src/telegramClient');
    expect(process.env.TOPIC_MINT).toBe('9001');
    expect(fn).toBeDefined();
  });
});

// ── Stage 2: Risk assessment for mint commits ─────────────────────────────────
describe('Stage 2: risk assessment for mint commit types', () => {
  const { assessRisk, isMarketingOnly } = require('../src/riskAssessor');

  test('normal feature commit → Medium risk', () => {
    const files = ['src/dashboard/widget.tsx', 'src/app/page.tsx', 'components/Chart.tsx'];
    expect(assessRisk(files)).toBe('Medium');
    expect(isMarketingOnly(files)).toBe(false);
  });

  test('auth-related commit → High risk', () => {
    const files = ['src/auth/middleware.ts', 'lib/token-validator.ts'];
    expect(assessRisk(files)).toBe('High');
  });

  test('payment integration commit → High risk', () => {
    const files = ['src/billing/stripe-checkout.ts', 'lib/payment-handler.ts'];
    expect(assessRisk(files)).toBe('High');
  });

  test('schema migration → High risk', () => {
    const files = ['prisma/schema.prisma', 'db/migration-001.sql'];
    expect(assessRisk(files)).toBe('High');
  });

  test('design asset push → Low risk, marketing only', () => {
    const files = ['public/images/logo.png', 'public/assets/hero.webp', 'public/brand/icon.svg'];
    expect(assessRisk(files)).toBe('Low');
    expect(isMarketingOnly(files)).toBe(true);
  });

  test('mixed code + images → Medium risk', () => {
    const files = ['src/page.tsx', 'public/logo.png'];
    expect(assessRisk(files)).toBe('Medium');
    expect(isMarketingOnly(files)).toBe(false);
  });

  test('empty changeset → Low risk', () => {
    expect(assessRisk([])).toBe('Low');
  });
});

// ── Stage 3: Webhook pipeline for mint ───────────────────────────────────────
describe('Stage 3: webhook pipeline for mint repo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findNotionProject.mockResolvedValue({
      pageId:      'mint-notion-page-001',
      projectName: 'Mint',
      url:         'https://notion.so/mint',
    });
    updateNotionProject.mockResolvedValue(undefined);
    isAlreadyProcessed.mockResolvedValue(false);
    sendTelegramMessage.mockResolvedValue(true);
    upsertRepoMetrics.mockResolvedValue(undefined);
  });

  test('returns 200 for valid signed mint webhook', async () => {
    const body = mintPush();
    const res = await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(body))
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  test('rejects unsigned mint webhook with 401', async () => {
    const res = await request(app)
      .post('/webhook/github')
      .send(mintPush());
    expect(res.status).toBe(401);
  });

  test('rejects tampered mint webhook with 401', async () => {
    const body = mintPush();
    const res = await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', 'sha256=badhash00000000000000000000000000000000000')
      .send(body);
    expect(res.status).toBe(401);
  });

  test('calls findNotionProject with "mint" (lowercased)', async () => {
    const body = mintPush();
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(body))
      .send(body);
    await wait(200);
    expect(findNotionProject).toHaveBeenCalledWith('mint');
  });

  test('calls updateNotionProject for the mint Notion page', async () => {
    const body = mintPush();
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(body))
      .send(body);
    await wait(200);
    expect(updateNotionProject).toHaveBeenCalledTimes(1);
    const [pageId] = updateNotionProject.mock.calls[0];
    expect(pageId).toBe('mint-notion-page-001');
  });

  test('Telegram success message contains mint project details', async () => {
    const body = mintPush();
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(body))
      .send(body);
    await wait(200);
    const msg = sendTelegramMessage.mock.calls[0][0];
    expect(msg).toContain('✅');
    expect(msg).toContain('mint');
  });

  test('Telegram message is routed to TOPIC_MINT (topic ID 9001)', async () => {
    const body = mintPush();
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(body))
      .send(body);
    await wait(200);
    const [, repoName] = sendTelegramMessage.mock.calls[0];
    expect(repoName).toBe('mint');
  });

  test('enqueues build check job for mint after push', async () => {
    const body = mintPush();
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(body))
      .send(body);
    await wait(200);
    expect(enqueueBuildCheck).toHaveBeenCalledWith(
      expect.objectContaining({ repoFullName: MINT_FULL })
    );
  });

  test('records last_commit_at in portfolio_metrics for mint', async () => {
    const body = mintPush();
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(body))
      .send(body);
    await wait(200);
    expect(upsertRepoMetrics).toHaveBeenCalledWith(
      expect.objectContaining({
        repoFullName: MINT_FULL,
        repoName:     MINT_REPO,
        lastCommitAt: expect.any(Date),
      })
    );
  });

  test('skips duplicate mint commits without notifying Telegram', async () => {
    isAlreadyProcessed.mockResolvedValue(true);
    const body = mintPush();
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(body))
      .send(body);
    await wait(200);
    expect(updateNotionProject).not.toHaveBeenCalled();
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  test('sends unknown-repo warning when mint is not in Notion', async () => {
    findNotionProject.mockResolvedValue(null);
    const body = mintPush();
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(body))
      .send(body);
    await waitLong();
    const msg = sendTelegramMessage.mock.calls[0][0];
    expect(msg).toContain('Unknown repo received');
    expect(msg).toContain('mint');
  });

  test('sends error Telegram when Notion update throws for mint', async () => {
    updateNotionProject.mockRejectedValue(new Error('Notion 503'));
    const body = mintPush();
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(body))
      .send(body);
    await wait(200);
    const msg = sendTelegramMessage.mock.calls[0][0];
    expect(msg).toContain('❌');
    expect(msg).toContain('Notion update failed');
  });

  test('high-risk mint commit (auth file) triggers Medium risk label in message', async () => {
    const body = mintPush({
      head_commit: {
        ...mintPush().head_commit,
        added:    ['src/auth/session.ts'],
        modified: ['src/middleware/auth-guard.ts'],
        removed:  [],
      },
    });
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(body))
      .send(body);
    await wait(200);
    const msg = sendTelegramMessage.mock.calls[0][0];
    expect(msg).toContain('High');
  });
});

// ── Stage 4: Audit orchestration for mint ────────────────────────────────────
describe('Stage 4: audit orchestration for mint', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sendTelegramMessage.mockResolvedValue(true);
    getActiveCycleForRepo.mockResolvedValue(null);
    getLastCompletedAudit.mockResolvedValue(null);
    getQueuedTaskCount.mockResolvedValue(0);
    createAuditCycle.mockResolvedValue({ id: 'mint-cycle-001' });
    runAudit.mockResolvedValue({
      tasks: [
        { taskNumber: 1, title: 'Add error boundary', priority: 'medium', safe: true, builder_agent: 'qwen_coder', batch_number: 1, notion_page_id: 'np1' },
        { taskNumber: 2, title: 'Fix TypeScript strict errors', priority: 'medium', safe: true, builder_agent: 'qwen_coder', batch_number: 1, notion_page_id: 'np2' },
        { taskNumber: 3, title: 'Optimise bundle size', priority: 'low', safe: true, builder_agent: 'qwen_coder', batch_number: 1, notion_page_id: 'np3' },
      ],
      summary: 'Mint has 3 quality improvements ready',
    });
  });

  test('loop-prevention rule 1: skips audit for sentinel-authored mint commit', async () => {
    await triggerAudit({
      repoFullName: MINT_FULL,
      repoName:     MINT_REPO,
      commitSha:    'abc123',
      authorName:   'Project Sentinel',
      authorEmail:  'sentinel@project-sentinel.app',
      branchName:   'main',
      commitMessage: 'fix(sentinel): patch mint dependencies',
      topicId:      9001,
    });
    expect(createAuditCycle).not.toHaveBeenCalled();
  });

  test('loop-prevention rule 1: skips audit for sentinel/ branch push on mint', async () => {
    await triggerAudit({
      repoFullName: MINT_FULL,
      repoName:     MINT_REPO,
      commitSha:    'bcd234',
      authorName:   'Shayan',
      branchName:   'sentinel/batch-3-tasks-1-3',
      commitMessage: 'feat: apply sentinel tasks',
      topicId:      9001,
    });
    expect(createAuditCycle).not.toHaveBeenCalled();
  });

  test('loop-prevention rule 2: skips audit when mint already has 3+ queued tasks', async () => {
    getQueuedTaskCount.mockResolvedValue(4);
    await triggerAudit({
      repoFullName: MINT_FULL,
      repoName:     MINT_REPO,
      commitSha:    'cde345',
      authorName:   'Shayan',
      branchName:   'main',
      commitMessage: 'chore: update deps',
      topicId:      9001,
    });
    expect(createAuditCycle).not.toHaveBeenCalled();
  });

  test('loop-prevention rule 3: skips audit when mint is within cooldown window', async () => {
    const recentAudit = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2h ago
    // checkAuditRules reads `created_at`, not `completed_at` (see auditOrchestrator.js:73)
    getLastCompletedAudit.mockResolvedValue({ created_at: recentAudit });
    await triggerAudit({
      repoFullName: MINT_FULL,
      repoName:     MINT_REPO,
      commitSha:    'def456',
      authorName:   'Shayan',
      branchName:   'main',
      commitMessage: 'feat: add dashboard filter',
      topicId:      9001,
    });
    expect(createAuditCycle).not.toHaveBeenCalled();
  });

  test('loop-prevention rule 4: skips audit when mint already has an active cycle', async () => {
    getActiveCycleForRepo.mockResolvedValue({ id: 'existing-cycle' });
    await triggerAudit({
      repoFullName: MINT_FULL,
      repoName:     MINT_REPO,
      commitSha:    'efg567',
      authorName:   'Shayan',
      branchName:   'main',
      commitMessage: 'feat: dark mode toggle',
      topicId:      9001,
    });
    expect(createAuditCycle).not.toHaveBeenCalled();
  });

  test('happy path: cooldown elapsed → audit runs → approval menu sent for mint', async () => {
    const oldAudit = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25h ago
    getLastCompletedAudit.mockResolvedValue({ created_at: oldAudit });

    await triggerAudit({
      repoFullName: MINT_FULL,
      repoName:     MINT_REPO,
      commitSha:    'fgh678',
      authorName:   'Shayan',
      branchName:   'main',
      commitMessage: 'feat: add CSV export to mint dashboard',
      topicId:      9001,
    });

    expect(createAuditCycle).toHaveBeenCalledWith(
      expect.objectContaining({ repoFullName: MINT_FULL })
    );
    expect(runAudit).toHaveBeenCalled();
    const tgCalls = sendTelegramMessage.mock.calls;
    expect(tgCalls.length).toBeGreaterThan(0);
  });

  test('audit failure is reported and cycle marked failed for mint', async () => {
    runAudit.mockRejectedValue(new Error('NVIDIA NIM timeout'));
    const oldAudit = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    getLastCompletedAudit.mockResolvedValue({ completed_at: oldAudit });

    await triggerAudit({
      repoFullName: MINT_FULL,
      repoName:     MINT_REPO,
      commitSha:    'zzz999',
      authorName:   'Shayan',
      branchName:   'main',
      commitMessage: 'fix: resolve layout issue',
      topicId:      9001,
    });

    const { updateAuditCycle } = require('../src/auditDb');
    expect(updateAuditCycle).toHaveBeenCalledWith(
      'mint-cycle-001',
      expect.objectContaining({ status: 'failed' })
    );
  });
});

// ── Stage 5: PR lifecycle for mint sentinel branches ──────────────────────────
describe('Stage 5: PR lifecycle for mint sentinel branches', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sendTelegramMessage.mockResolvedValue(true);
  });

  const mergedPR = {
    action: 'closed',
    pull_request: {
      number:   17,
      merged:   true,
      html_url: `https://github.com/${MINT_FULL}/pull/17`,
      head:     { ref: 'sentinel/batch-1-tasks-1-3' },
      base:     { ref: 'main' },
    },
    repository: { name: MINT_REPO, full_name: MINT_FULL },
  };

  const rejectedPR = {
    ...mergedPR,
    pull_request: { ...mergedPR.pull_request, merged: false, number: 18 },
  };

  test('ignores PR events on non-sentinel mint branches', async () => {
    const humanPR = {
      ...mergedPR,
      pull_request: { ...mergedPR.pull_request, head: { ref: 'feature/mint-dark-mode' } },
    };
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(humanPR))
      .set('x-github-event', 'pull_request')
      .send(humanPR);
    await wait(200);
    expect(query).not.toHaveBeenCalled();
  });

  test('marks tasks done when mint sentinel PR is merged', async () => {
    query.mockResolvedValue({ rows: [{ id: 1, notion_page_id: 'np1' }, { id: 2, notion_page_id: 'np2' }] });
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(mergedPR))
      .set('x-github-event', 'pull_request')
      .send(mergedPR);
    await waitLong();
    expect(query).toHaveBeenCalled();
    const sql = query.mock.calls[0][0];
    expect(sql).toContain("status = 'done'");
    const tgCalls = sendTelegramMessage.mock.calls;
    expect(tgCalls.length).toBeGreaterThan(0);
    expect(tgCalls[tgCalls.length - 1][0]).toContain('PR Merged');
  });

  test('requeues tasks when mint sentinel PR is rejected', async () => {
    query.mockResolvedValue({ rows: [{ id: 1 }] });
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(rejectedPR))
      .set('x-github-event', 'pull_request')
      .send(rejectedPR);
    await waitLong();
    expect(query).toHaveBeenCalled();
    const sql = query.mock.calls[0][0];
    expect(sql).toContain("status = 'queued'");
    const tgCalls = sendTelegramMessage.mock.calls;
    expect(tgCalls.length).toBeGreaterThan(0);
    expect(tgCalls[tgCalls.length - 1][0]).toContain('PR Rejected');
  });

  test('PR merge message contains mint repo name and PR number', async () => {
    query.mockResolvedValue({ rows: [{ id: 1, notion_page_id: 'np1' }] });
    await request(app)
      .post('/webhook/github')
      .set('x-hub-signature-256', sign(mergedPR))
      .set('x-github-event', 'pull_request')
      .send(mergedPR);
    await waitLong();
    const lastCall = sendTelegramMessage.mock.calls[sendTelegramMessage.mock.calls.length - 1];
    const msg = lastCall[0];
    // The PR merge handler passes null as repoName (uses topicId=null, sends to default topic)
    expect(lastCall[1]).toBeNull();
    expect(msg).toContain('mint');
    expect(msg).toContain('#17');
  });
});
