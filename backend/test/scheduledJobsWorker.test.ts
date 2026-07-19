const redisMock = {
  get: jest.fn(),
  del: jest.fn().mockResolvedValue(1),
};
const getRedisConnectionMock = jest.fn(() => redisMock);

jest.mock('../src/queueClient', () => ({
  getRedisConnection: () => getRedisConnectionMock(),
}));

const sendTelegramMessageMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/telegramClient', () => ({
  sendTelegramMessage: (...a: any[]) => sendTelegramMessageMock(...a),
}));

const approveSprintMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/sprintOrchestrator', () => ({
  approveSprint: (...a: any[]) => approveSprintMock(...a),
}));

const checkPostMergeImpactMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/correlationEngine', () => ({
  checkPostMergeImpact: (...a: any[]) => checkPostMergeImpactMock(...a),
}));

import { processScheduledJob, AUTO_APPROVE_JOB, PR_IMPACT_CHECK_JOB } from '../src/workers/scheduledJobsWorker';

/**
 * NOTE on scope: these tests exercise processScheduledJob() directly with
 * plain mock job objects — they verify OUR handler logic (the
 * still-pending / superseded-sprint checks, which downstream calls fire)
 * is correct. They do NOT and cannot prove BullMQ's own delayed-job
 * persistence-across-restart guarantee, since that requires a live Redis
 * server (none is available in this environment — no local Redis, no
 * ioredis-mock installed, and BullMQ's Lua-script-heavy internals are not
 * reliably reproduced by mock Redis implementations anyway). That
 * persistence guarantee is BullMQ's own documented, widely-relied-upon
 * behavior, not something this test suite re-verifies from scratch.
 */
describe('processScheduledJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getRedisConnectionMock.mockReturnValue(redisMock);
  });

  describe(AUTO_APPROVE_JOB, () => {
    it('approves the sprint and clears the pending key when it matches the fired job', async () => {
      redisMock.get.mockResolvedValue(JSON.stringify({ sprintId: 'sprint-1', topicId: 'topic-1' }));

      await processScheduledJob({ name: AUTO_APPROVE_JOB, data: { sprintId: 'sprint-1', topicId: 'topic-1' } });

      expect(redisMock.del).toHaveBeenCalledWith('sentinel:sprint:pending-auto-approve');
      expect(sendTelegramMessageMock).toHaveBeenCalledTimes(1);
      expect(approveSprintMock).toHaveBeenCalledWith('topic-1');
    });

    it('skips (no approve, no Telegram message) when nothing is pending anymore', async () => {
      redisMock.get.mockResolvedValue(null);

      await processScheduledJob({ name: AUTO_APPROVE_JOB, data: { sprintId: 'sprint-1', topicId: 'topic-1' } });

      expect(redisMock.del).not.toHaveBeenCalled();
      expect(approveSprintMock).not.toHaveBeenCalled();
      expect(sendTelegramMessageMock).not.toHaveBeenCalled();
    });

    it('skips when the fired job is for a superseded sprint (regression guard for the jobId-reuse fix)', async () => {
      redisMock.get.mockResolvedValue(JSON.stringify({ sprintId: 'sprint-2', topicId: 'topic-2' }));

      await processScheduledJob({ name: AUTO_APPROVE_JOB, data: { sprintId: 'sprint-1', topicId: 'topic-1' } });

      expect(redisMock.del).not.toHaveBeenCalled();
      expect(approveSprintMock).not.toHaveBeenCalled();
      expect(sendTelegramMessageMock).not.toHaveBeenCalled();
    });

    it('still approves (skipping the redis check) if Redis is unavailable', async () => {
      getRedisConnectionMock.mockReturnValue(null);

      await processScheduledJob({ name: AUTO_APPROVE_JOB, data: { sprintId: 'sprint-1', topicId: 'topic-1' } });

      expect(approveSprintMock).toHaveBeenCalledWith('topic-1');
    });
  });

  describe(PR_IMPACT_CHECK_JOB, () => {
    it('delegates to correlationEngine.checkPostMergeImpact with the job data', async () => {
      await processScheduledJob({ name: PR_IMPACT_CHECK_JOB, data: { impactId: 'impact-1', repoName: 'tapcash' } });
      expect(checkPostMergeImpactMock).toHaveBeenCalledWith('impact-1', 'tapcash');
    });
  });

  it('logs a warning and does nothing for an unknown job name', async () => {
    await expect(
      processScheduledJob({ name: 'something-else', data: {} })
    ).resolves.toBeUndefined();
    expect(approveSprintMock).not.toHaveBeenCalled();
    expect(checkPostMergeImpactMock).not.toHaveBeenCalled();
  });
});
