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
const executeNextSprintTaskMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/sprintOrchestrator', () => ({
  approveSprint: (...a: any[]) => approveSprintMock(...a),
  executeNextSprintTask: (...a: any[]) => executeNextSprintTaskMock(...a),
}));

const checkPostMergeImpactMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/correlationEngine', () => ({
  checkPostMergeImpact: (...a: any[]) => checkPostMergeImpactMock(...a),
}));

const checkApprovalTimeoutMock = jest.fn().mockResolvedValue(undefined);
const triggerAuditMock         = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/auditOrchestrator', () => ({
  checkApprovalTimeout: (...a: any[]) => checkApprovalTimeoutMock(...a),
  triggerAudit:         (...a: any[]) => triggerAuditMock(...a),
}));

const hasCodeRabbitAuditedCommitMock = jest.fn();
const hasCodeRabbitFindingSinceMock  = jest.fn();
jest.mock('../src/auditDb', () => ({
  hasCodeRabbitAuditedCommit:  (...a: any[]) => hasCodeRabbitAuditedCommitMock(...a),
  hasCodeRabbitFindingSince:   (...a: any[]) => hasCodeRabbitFindingSinceMock(...a),
}));

const reviewPrDiffMock = jest.fn().mockResolvedValue({ ran: true, findingsCreated: 0 });
jest.mock('../src/selfReviewer', () => ({
  reviewPrDiff: (...a: any[]) => reviewPrDiffMock(...a),
}));

const runRoundtableSynthesisMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/agents/roundtable', () => ({
  runRoundtableSynthesis: (...a: any[]) => runRoundtableSynthesisMock(...a),
}));

import { processScheduledJob, AUTO_APPROVE_JOB, PR_IMPACT_CHECK_JOB, SPRINT_CONTINUE_JOB, AUDIT_APPROVAL_TIMEOUT_JOB, CODERABBIT_FALLBACK_JOB, ROUNDTABLE_TIMEOUT_JOB, SELF_REVIEW_FALLBACK_JOB } from '../src/workers/scheduledJobsWorker';

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

  describe(SPRINT_CONTINUE_JOB, () => {
    it('delegates to sprintOrchestrator.executeNextSprintTask with the job data — regression guard for the bare-setTimeout sprint-continuation bug', async () => {
      await processScheduledJob({ name: SPRINT_CONTINUE_JOB, data: { sprintId: 42, topicId: 'topic-1' } });
      expect(executeNextSprintTaskMock).toHaveBeenCalledWith(42, 'topic-1');
    });
  });

  describe(AUDIT_APPROVAL_TIMEOUT_JOB, () => {
    it('delegates to auditOrchestrator.checkApprovalTimeout with the job data — regression guard for the bare-setTimeout 24h approval-expiry bug', async () => {
      await processScheduledJob({
        name: AUDIT_APPROVAL_TIMEOUT_JOB,
        data: { cycleId: 7, repoFullName: 'org/tapcash', repoName: 'tapcash', topicId: 'topic-1' },
      });
      expect(checkApprovalTimeoutMock).toHaveBeenCalledWith(7, 'org/tapcash', 'tapcash', 'topic-1');
    });
  });

  describe(CODERABBIT_FALLBACK_JOB, () => {
    const jobData = {
      repoFullName: 'org/costpilot',
      commitSha: 'abc123',
      auditPayload: { repoFullName: 'org/costpilot', commitSha: 'abc123', repoName: 'costpilot' },
    };

    it('skips the Sentinel fallback audit when CodeRabbit already audited this commit', async () => {
      hasCodeRabbitAuditedCommitMock.mockResolvedValue(true);
      await processScheduledJob({ name: CODERABBIT_FALLBACK_JOB, data: jobData });
      expect(hasCodeRabbitAuditedCommitMock).toHaveBeenCalledWith('org/costpilot', 'abc123');
      expect(triggerAuditMock).not.toHaveBeenCalled();
    });

    it('runs the Sentinel fallback audit when CodeRabbit never audited this commit', async () => {
      hasCodeRabbitAuditedCommitMock.mockResolvedValue(false);
      await processScheduledJob({ name: CODERABBIT_FALLBACK_JOB, data: jobData });
      expect(triggerAuditMock).toHaveBeenCalledWith(jobData.auditPayload);
    });

    it('errs toward running the fallback audit (not silently skipping) if the DB check itself fails', async () => {
      hasCodeRabbitAuditedCommitMock.mockRejectedValue(new Error('db down'));
      await processScheduledJob({ name: CODERABBIT_FALLBACK_JOB, data: jobData });
      expect(triggerAuditMock).toHaveBeenCalledWith(jobData.auditPayload);
    });
  });

  describe(SELF_REVIEW_FALLBACK_JOB, () => {
    const jobData = {
      repoFullName: 'org/costpilot', repoName: 'costpilot',
      prNumber: 12, prUrl: 'https://github.com/org/costpilot/pull/12',
      topicId: 'topic-1', pushedAt: '2026-07-29T00:00:00.000Z',
    };

    it('skips self-review when CodeRabbit already responded on this PR since the push', async () => {
      hasCodeRabbitFindingSinceMock.mockResolvedValue(true);
      await processScheduledJob({ name: SELF_REVIEW_FALLBACK_JOB, data: jobData });
      expect(hasCodeRabbitFindingSinceMock).toHaveBeenCalledWith('org/costpilot', '2026-07-29T00:00:00.000Z');
      expect(reviewPrDiffMock).not.toHaveBeenCalled();
    });

    it('runs the self-review fallback when CodeRabbit has not responded', async () => {
      hasCodeRabbitFindingSinceMock.mockResolvedValue(false);
      await processScheduledJob({ name: SELF_REVIEW_FALLBACK_JOB, data: jobData });
      expect(reviewPrDiffMock).toHaveBeenCalledWith({
        repoFullName: 'org/costpilot', repoName: 'costpilot',
        prNumber: 12, prUrl: 'https://github.com/org/costpilot/pull/12', topicId: 'topic-1',
      });
    });

    it('errs toward running self-review (not silently skipping) if the DB check itself fails', async () => {
      hasCodeRabbitFindingSinceMock.mockRejectedValue(new Error('db down'));
      await processScheduledJob({ name: SELF_REVIEW_FALLBACK_JOB, data: jobData });
      expect(reviewPrDiffMock).toHaveBeenCalled();
    });
  });

  describe(ROUNDTABLE_TIMEOUT_JOB, () => {
    it('delegates to roundtable.runRoundtableSynthesis with the session id', async () => {
      await processScheduledJob({ name: ROUNDTABLE_TIMEOUT_JOB, data: { sessionId: 5 } });
      expect(runRoundtableSynthesisMock).toHaveBeenCalledWith(5);
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
