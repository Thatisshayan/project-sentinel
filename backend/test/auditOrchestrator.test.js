process.env.GITHUB_WEBHOOK_SECRET = 'test-secret-for-jest';
process.env.TELEGRAM_BOT_TOKEN    = 'test-tg-token';
process.env.TELEGRAM_CHAT_ID      = '-100123456789';

jest.mock('../src/claudeCodeAudit', () => ({
  runAudit: jest.fn(),
}));

jest.mock('../src/auditTaskWriter', () => ({
  writeTasksToNotion:    jest.fn(),
  updateNotionTaskStatus: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/taskBuilder', () => ({
  executeBatch: jest.fn(),
}));

jest.mock('../src/prCreator', () => ({
  createPullRequest: jest.fn(),
}));

jest.mock('../src/telegramClient', () => ({
  sendTelegramMessage: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/telegramMenus', () => ({
  sendMenu: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/notionClient', () => ({
  findNotionProject: jest.fn().mockResolvedValue(null),
}));

jest.mock('../src/auditDb', () => ({
  createAuditCycle:        jest.fn(),
  updateAuditCycle:        jest.fn().mockResolvedValue(undefined),
  getActiveCycleForRepo:   jest.fn(),
  getLastCompletedAudit:   jest.fn().mockResolvedValue(null),
  getPreviousHealthScore: jest.fn().mockResolvedValue(null),
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

jest.mock('../src/dbClient', () => ({
  query: jest.fn().mockResolvedValue({ rows: [{ count: '0' }] }),
}));

const {
  triggerAudit,
  executeApprovedTasks,
  processNextBatch,
  handleBuildPassedAfterSentinelMerge,
} = require('../src/auditOrchestrator');

const { runAudit }                       = require('../src/claudeCodeAudit');
const { writeTasksToNotion }             = require('../src/auditTaskWriter');
const { executeBatch }                   = require('../src/taskBuilder');
const { createPullRequest }              = require('../src/prCreator');
const { sendTelegramMessage }            = require('../src/telegramClient');
const { sendMenu }                       = require('../src/telegramMenus');
const {
  createAuditCycle, updateAuditCycle,
  getActiveCycleForRepo, getLastCompletedAudit, getPreviousHealthScore,
  getQueuedTaskCount, getNextBatch,
  countTasksExecutedToday, markTasksDoneForBranch,
} = require('../src/auditDb');
const { query } = require('../src/dbClient');

const basePayload = {
  repoFullName:  'your-org/tapcash',
  repoName:      'tapcash',
  projectName:   'Tapcash',
  commitSha:     'deadbeef1234567890deadbeef1234567890dead',
  commitMessage: 'fix: improve validation',
  branchName:    'main',
  authorName:    'Test User',
  authorEmail:   'test@example.com',
  topicId:       null,
};

const auditResult = {
  overallHealthScore: 7,
  auditSummary: 'Looks decent overall.',
  tasks: [
    { taskNumber: 1, title: 'Fix lint', priority: 'low', category: 'code-quality', safeToAutoExecute: true },
    { taskNumber: 2, title: 'Add tests', priority: 'medium', category: 'testing', safeToAutoExecute: true },
    { taskNumber: 3, title: 'Refactor auth', priority: 'high', category: 'security', safeToAutoExecute: false, safetyReason: 'Touches authentication logic' },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  getActiveCycleForRepo.mockResolvedValue(null);
  getLastCompletedAudit.mockResolvedValue(null);
  getPreviousHealthScore.mockResolvedValue(null);
  getQueuedTaskCount.mockResolvedValue(0);
  countTasksExecutedToday.mockResolvedValue(0);
  getNextBatch.mockResolvedValue([]);
  createAuditCycle.mockResolvedValue({ id: 'cycle-1' });
  runAudit.mockResolvedValue(auditResult);
  writeTasksToNotion.mockResolvedValue({ failed: [], skipped: [] });
  query.mockResolvedValue({ rows: [{ count: '0' }] });
});

describe('triggerAudit — loop-prevention rules', () => {
  test('Rule 1: skips audit for Sentinel-authored commit', async () => {
    await triggerAudit({ ...basePayload, authorName: 'Project Sentinel' });

    expect(createAuditCycle).not.toHaveBeenCalled();
    expect(runAudit).not.toHaveBeenCalled();
  });

  test('Rule 1: skips audit for sentinel/ branch', async () => {
    await triggerAudit({ ...basePayload, branchName: 'sentinel/fix-123' });

    expect(runAudit).not.toHaveBeenCalled();
  });

  test('Rule 2: skips audit and notifies when queued tasks exceed threshold', async () => {
    getQueuedTaskCount.mockResolvedValue(5);

    await triggerAudit(basePayload);

    expect(runAudit).not.toHaveBeenCalled();
    expect(sendTelegramMessage).toHaveBeenCalledWith(
      expect.stringContaining('Audit Skipped'),
      null,
      basePayload.topicId
    );
  });

  test('Rule 3: skips audit when within cooldown window', async () => {
    getLastCompletedAudit.mockResolvedValue({
      created_at: new Date(Date.now() - 1 * 3600000).toISOString(),
    });

    await triggerAudit(basePayload);

    expect(runAudit).not.toHaveBeenCalled();
  });

  test('Rule 3: allows audit once cooldown has elapsed', async () => {
    getLastCompletedAudit.mockResolvedValue({
      created_at: new Date(Date.now() - 13 * 3600000).toISOString(),
    });

    await triggerAudit(basePayload);

    expect(runAudit).toHaveBeenCalled();
  });

  test('skips when a cycle is already active for the repo (duplicate-cycle prevention)', async () => {
    getActiveCycleForRepo.mockResolvedValue({ id: 'existing-cycle' });

    await triggerAudit(basePayload);

    expect(createAuditCycle).not.toHaveBeenCalled();
    expect(runAudit).not.toHaveBeenCalled();
  });

  test('skips entirely when commitSha or repoFullName missing', async () => {
    await triggerAudit({ ...basePayload, commitSha: null });
    expect(getActiveCycleForRepo).not.toHaveBeenCalled();
  });
});

describe('triggerAudit — happy path', () => {
  test('runs audit, writes tasks, and sends approval menu', async () => {
    await triggerAudit(basePayload);

    expect(runAudit).toHaveBeenCalledWith(expect.objectContaining({
      repoFullName: basePayload.repoFullName,
      commitSha:    basePayload.commitSha,
    }));
    expect(writeTasksToNotion).toHaveBeenCalledWith(
      auditResult, 'cycle-1', expect.objectContaining({ repoFullName: basePayload.repoFullName })
    );
    expect(updateAuditCycle).toHaveBeenCalledWith('cycle-1', expect.objectContaining({
      status: 'awaiting_approval',
      tasks_total: 3,
      tasks_safe: 2,
    }));
    expect(sendMenu).toHaveBeenCalled();
  });

  test('audit report includes priority breakdown, per-task category, lock reasons, and health trend', async () => {
    getPreviousHealthScore.mockResolvedValue(5);

    await triggerAudit(basePayload);

    const auditText = sendMenu.mock.calls[0][2];
    expect(auditText).toContain('7/10 (↑ +2 vs last audit)');
    expect(auditText).toContain('🟠 1 high  ·  🟡 1 medium  ·  🟢 1 low');
    expect(auditText).toContain('[code-quality] Fix lint');
    expect(auditText).toContain('[security] Refactor auth');
    expect(auditText).toContain('🔒 Touches authentication logic');
  });

  test('omits the health trend line entirely when there is no previous audit to compare against', async () => {
    getPreviousHealthScore.mockResolvedValue(null);

    await triggerAudit(basePayload);

    const auditText = sendMenu.mock.calls[0][2];
    expect(auditText).toContain('Health Score: 7/10');
    expect(auditText).not.toContain('vs last audit');
  });

  test('shows a downward trend arrow when health score dropped since the last audit', async () => {
    getPreviousHealthScore.mockResolvedValue(9);

    await triggerAudit(basePayload);

    const auditText = sendMenu.mock.calls[0][2];
    expect(auditText).toContain('7/10 (↓ -2 vs last audit)');
  });

  test('marks cycle failed and notifies when runAudit throws', async () => {
    runAudit.mockRejectedValue(new Error('model timeout'));

    await triggerAudit(basePayload);

    expect(updateAuditCycle).toHaveBeenCalledWith('cycle-1', { status: 'failed' });
    expect(sendTelegramMessage).toHaveBeenCalledWith(
      expect.stringContaining('Audit Failed'),
      null,
      basePayload.topicId
    );
  });
});

describe('executeApprovedTasks', () => {
  test('notifies and exits early when builder disabled', async () => {
    process.env.BUILDER_AGENT_ENABLED = 'false';

    await executeApprovedTasks('your-org/tapcash', 'tapcash', null);

    expect(sendTelegramMessage).toHaveBeenCalledWith(
      expect.stringContaining('Builder disabled'),
      null, null
    );
    expect(getActiveCycleForRepo).not.toHaveBeenCalled();

    delete process.env.BUILDER_AGENT_ENABLED;
  });

  test('notifies when no active cycle and no queued tasks', async () => {
    getActiveCycleForRepo.mockResolvedValue(null);
    query.mockResolvedValue({ rows: [{ count: '0' }] });

    await executeApprovedTasks('your-org/tapcash', 'tapcash', null);

    expect(sendTelegramMessage).toHaveBeenCalledWith(
      expect.stringContaining('No queued tasks'),
      null, null
    );
    expect(createAuditCycle).not.toHaveBeenCalled();
  });

  test('creates a synthetic cycle and proceeds when queued tasks exist without an active cycle', async () => {
    getActiveCycleForRepo.mockResolvedValue(null);
    query.mockResolvedValue({ rows: [{ count: '4' }] });
    createAuditCycle.mockResolvedValue({ id: 'synthetic-cycle' });
    getNextBatch.mockResolvedValue([]);

    await executeApprovedTasks('your-org/tapcash', 'tapcash', null);

    expect(createAuditCycle).toHaveBeenCalledWith(expect.objectContaining({
      repoFullName: 'your-org/tapcash',
      projectName:  'tapcash',
    }));
    expect(updateAuditCycle).toHaveBeenCalledWith('synthetic-cycle', expect.objectContaining({
      status: 'executing',
    }));
  });

  test('proceeds straight to processNextBatch when an active cycle already exists', async () => {
    getActiveCycleForRepo.mockResolvedValue({ id: 'cycle-1' });
    getNextBatch.mockResolvedValue([]);

    await executeApprovedTasks('your-org/tapcash', 'tapcash', null);

    expect(updateAuditCycle).toHaveBeenCalledWith('cycle-1', expect.objectContaining({
      status: 'executing',
    }));
  });
});

describe('processNextBatch', () => {
  test('stops and notifies when daily limit reached', async () => {
    countTasksExecutedToday.mockResolvedValue(10);

    await processNextBatch('your-org/tapcash', 'tapcash', null);

    expect(sendTelegramMessage).toHaveBeenCalledWith(
      expect.stringContaining('Daily Limit'),
      null, null
    );
    expect(getNextBatch).not.toHaveBeenCalled();
  });

  test('marks cycle complete and notifies when no tasks remain', async () => {
    getNextBatch.mockResolvedValue([]);
    getActiveCycleForRepo.mockResolvedValue({ id: 'cycle-1' });

    await processNextBatch('your-org/tapcash', 'tapcash', null);

    expect(updateAuditCycle).toHaveBeenCalledWith('cycle-1', { status: 'complete' });
    expect(sendTelegramMessage).toHaveBeenCalledWith(
      expect.stringContaining('All Safe Tasks Complete'),
      null, null
    );
  });

  const sampleTasks = [
    { id: 't1', task_number: 1, title: 'Fix lint', builder_agent: 'nvidia',
      batch_number: 1, notion_page_id: 'np1' },
    { id: 't2', task_number: 2, title: 'Add tests', builder_agent: 'nvidia',
      batch_number: 1, notion_page_id: 'np2' },
  ];

  test('on success: creates a PR, marks tasks build_check, requeues skipped tasks', async () => {
    getNextBatch.mockResolvedValue(sampleTasks);
    executeBatch.mockResolvedValue({
      status: 'completed',
      completedTasks: [sampleTasks[0]],
      taskBranch: 'sentinel/batch-1',
      commitSha: 'abc1234',
      commitUrl: 'https://github.com/your-org/tapcash/commit/abc1234',
      builderUsed: 'nvidia',
      remainingTasks: 0,
    });
    createPullRequest.mockResolvedValue({ prUrl: 'https://github.com/pr/1', prNumber: 1 });

    await processNextBatch('your-org/tapcash', 'tapcash', null);

    expect(createPullRequest).toHaveBeenCalled();
    expect(sendTelegramMessage).toHaveBeenCalledWith(
      expect.stringContaining('Batch 1 Ready'),
      null, null
    );
  });

  test('retries with fallback builder when primary builder fails, then succeeds', async () => {
    getNextBatch.mockResolvedValue(sampleTasks);
    executeBatch
      .mockResolvedValueOnce({ status: 'failed', reason: 'aider crashed' })
      .mockResolvedValueOnce({
        status: 'completed',
        completedTasks: sampleTasks,
        taskBranch: 'sentinel/batch-1',
        commitSha: 'def5678',
        commitUrl: 'https://github.com/your-org/tapcash/commit/def5678',
        builderUsed: 'qwen_coder',
        remainingTasks: 0,
      });
    createPullRequest.mockResolvedValue({ prUrl: 'https://github.com/pr/2', prNumber: 2 });

    // Isolate the fallback chain: only NVIDIA_API_KEY should be available so that
    // claude_code (ANTHROPIC_API_KEY), qwen_coder_dash (DASHSCOPE_API_KEY), and
    // gemini (GEMINI_API_KEY) are all skipped, leaving qwen_coder as the winner.
    const savedAnthropicKey  = process.env.ANTHROPIC_API_KEY;
    const savedDashscapeKey  = process.env.DASHSCOPE_API_KEY;
    const savedGeminiKey     = process.env.GEMINI_API_KEY;
    const savedDeepseekKey   = process.env.DEEPSEEK_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DASHSCOPE_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    process.env.NVIDIA_API_KEY = 'test-key';

    await processNextBatch('your-org/tapcash', 'tapcash', null);

    expect(executeBatch).toHaveBeenCalledTimes(2);
    expect(executeBatch.mock.calls[1][2]).toBe('qwen_coder');
    expect(createPullRequest).toHaveBeenCalled();

    delete process.env.NVIDIA_API_KEY;
    if (savedAnthropicKey !== undefined) process.env.ANTHROPIC_API_KEY = savedAnthropicKey;
    if (savedDashscapeKey !== undefined) process.env.DASHSCOPE_API_KEY = savedDashscapeKey;
    if (savedGeminiKey    !== undefined) process.env.GEMINI_API_KEY    = savedGeminiKey;
    if (savedDeepseekKey  !== undefined) process.env.DEEPSEEK_API_KEY  = savedDeepseekKey;
  });

  test('on total failure (no fallback succeeds): marks tasks failed and notifies', async () => {
    getNextBatch.mockResolvedValue(sampleTasks);
    executeBatch.mockResolvedValue({ status: 'failed', reason: 'all builders exhausted' });
    delete process.env.NVIDIA_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.DASHSCOPE_API_KEY;

    await processNextBatch('your-org/tapcash', 'tapcash', null);

    expect(createPullRequest).not.toHaveBeenCalled();
    expect(sendTelegramMessage).toHaveBeenCalledWith(
      expect.stringContaining('Batch 1 Failed'),
      null, null
    );
  });
});

describe('handleBuildPassedAfterSentinelMerge', () => {
  test('marks branch tasks done and finalizes cycle as complete when no tasks remain (regression: previously skipped finalization)', async () => {
    getNextBatch.mockResolvedValue([]);
    getActiveCycleForRepo.mockResolvedValue({ id: 'cycle-1' });
    countTasksExecutedToday.mockResolvedValue(0);

    await handleBuildPassedAfterSentinelMerge('your-org/tapcash', 'tapcash', 'sentinel/batch-1', null);

    expect(markTasksDoneForBranch).toHaveBeenCalledWith('your-org/tapcash', 'sentinel/batch-1');
    expect(updateAuditCycle).toHaveBeenCalledWith('cycle-1', { status: 'complete' });
    expect(sendTelegramMessage).toHaveBeenCalledWith(
      expect.stringContaining('All Safe Tasks Complete'),
      null, null
    );
  });

  test('starts the next batch when tasks remain after merge', async () => {
    const nextTasks = [
      { id: 't3', task_number: 3, title: 'Next task', builder_agent: 'nvidia',
        batch_number: 2, notion_page_id: 'np3' },
    ];
    getNextBatch.mockResolvedValue(nextTasks);
    executeBatch.mockResolvedValue({
      status: 'completed',
      completedTasks: nextTasks,
      taskBranch: 'sentinel/batch-2',
      commitSha: 'ghi9012',
      commitUrl: 'https://github.com/your-org/tapcash/commit/ghi9012',
      builderUsed: 'nvidia',
      remainingTasks: 0,
    });
    createPullRequest.mockResolvedValue({ prUrl: 'https://github.com/pr/3', prNumber: 3 });

    await handleBuildPassedAfterSentinelMerge('your-org/tapcash', 'tapcash', 'sentinel/batch-1', null);

    expect(markTasksDoneForBranch).toHaveBeenCalledWith('your-org/tapcash', 'sentinel/batch-1');
    expect(sendTelegramMessage).toHaveBeenCalledWith(
      expect.stringContaining('Batch 2 Ready'),
      null, null
    );
  });
});
