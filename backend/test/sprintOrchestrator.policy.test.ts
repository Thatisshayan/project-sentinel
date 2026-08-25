jest.mock('../src/telegramClient', () => ({
  sendTelegramMessage: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/projectDb', () => ({
  getActiveTaskBranch: jest.fn(),
  getRepoAutomationPolicy: jest.fn(),
}));

jest.mock('../src/sprintDb', () => ({
  getCurrentSprint: jest.fn(),
  getSprintById: jest.fn(),
  updateSprint: jest.fn().mockResolvedValue(undefined),
  getNextSprintTask: jest.fn(),
  updateSprintTask: jest.fn().mockResolvedValue(undefined),
  getSprintTasks: jest.fn(),
}));

jest.mock('../src/auditDb', () => ({
  updateAuditTask: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/taskBuilder', () => ({
  executeBatch: jest.fn(),
}));

jest.mock('../src/prCreator', () => ({
  createPullRequest: jest.fn(),
}));

jest.mock('../src/notionClient', () => ({
  findNotionProject: jest.fn(),
}));

jest.mock('../src/velocityTracker', () => ({
  recordWeeklyVelocity: jest.fn(),
  getVelocityReport: jest.fn(),
}));

jest.mock('../src/auditTaskWriter', () => ({
  updateNotionTaskStatus: jest.fn(),
}));

jest.mock('../src/queueClient', () => ({
  enqueueScheduledJob: jest.fn(),
}));

jest.mock('../src/boardroomDb', () => ({
  ensureProject: jest.fn().mockResolvedValue(undefined),
  recordEvent: jest.fn().mockResolvedValue(undefined),
  upsertTask: jest.fn(),
}));

jest.mock('../src/repoDiscovery', () => ({
  getDefaultBranch: jest.fn(),
}));

const projectDb = require('../src/projectDb');
const sprintDb = require('../src/sprintDb');
const { updateAuditTask } = require('../src/auditDb');
const { executeBatch } = require('../src/taskBuilder');
const { sendTelegramMessage } = require('../src/telegramClient');
const { executeNextSprintTask } = require('../src/sprintOrchestrator');

describe('sprintOrchestrator repo policy enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sprintDb.getSprintById.mockResolvedValue({
      id: 42,
      status: 'executing',
      total_tasks: 3,
      failed_tasks: 0,
      completed_tasks: 0,
    });
    sprintDb.getNextSprintTask.mockResolvedValue({
      id: 8,
      audit_task_id: 99,
      repo_name: 'tapcash',
      repo_full_name: 'your-org/tapcash',
      task_title: 'Tighten auth validation',
      execution_order: 1,
    });
    projectDb.getActiveTaskBranch.mockResolvedValue(null);
  });

  it('pauses the sprint when the repo policy blocks execution of the next task', async () => {
    projectDb.getRepoAutomationPolicy.mockResolvedValue({
      preset: 'audit-only',
      policy: {
        allowTaskExecution: false,
        allowPrOpen: false,
        allowPrUpdate: false,
        allowAutoPush: false,
      },
    });

    await executeNextSprintTask(42, null);

    expect(executeBatch).not.toHaveBeenCalled();
    expect(sprintDb.updateSprintTask).toHaveBeenCalledWith(8, {
      status: 'failed',
      failure_reason: 'Task execution is disabled by repo policy.',
    });
    expect(updateAuditTask).toHaveBeenCalledWith(99, {
      status: 'failed',
      failure_reason: 'Task execution is disabled by repo policy.',
    });
    expect(sprintDb.updateSprint).toHaveBeenCalledWith(42, {
      status: 'paused',
      failed_tasks: 1,
    });
    expect(sendTelegramMessage).toHaveBeenCalledWith(
      expect.stringContaining('Repo Policy Blocked Execution'),
      'tapcash',
      null
    );
  });
});
