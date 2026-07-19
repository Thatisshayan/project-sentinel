const redisMock = {
  set: jest.fn().mockResolvedValue('OK'),
  get: jest.fn(),
  del: jest.fn().mockResolvedValue(1),
};

const enqueueScheduledJobMock = jest.fn().mockResolvedValue({ id: 'job-1' });
const cancelScheduledJobMock  = jest.fn().mockResolvedValue(true);

jest.mock('../src/queueClient', () => ({
  getRedisConnection:  () => redisMock,
  enqueueScheduledJob: (...a: any[]) => enqueueScheduledJobMock(...a),
  cancelScheduledJob:  (...a: any[]) => cancelScheduledJobMock(...a),
}));

jest.mock('../src/settingsLoader', () => ({
  loadSettings: jest.fn().mockResolvedValue({ auto_approve_tasks: true }),
}));

jest.mock('../src/workers/scheduledJobsWorker', () => ({
  AUTO_APPROVE_JOB: 'auto-approve-sprint',
}));

import { scheduleAutoApprove, cancelAutoApprove } from '../src/autoApprover';

describe('autoApprover re-scheduling (BullMQ jobId reuse edge case)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisMock.set.mockResolvedValue('OK');
    redisMock.del.mockResolvedValue(1);
    enqueueScheduledJobMock.mockResolvedValue({ id: 'job-1' });
    cancelScheduledJobMock.mockResolvedValue(true);
  });

  it('cancels any existing scheduled job before enqueuing a new one on every call', async () => {
    await scheduleAutoApprove('sprint-1', 'topic-1');
    expect(cancelScheduledJobMock).toHaveBeenCalledWith('auto-approve-sprint');
    expect(enqueueScheduledJobMock).toHaveBeenCalledWith(
      'auto-approve-sprint',
      { sprintId: 'sprint-1', topicId: 'topic-1' },
      2 * 60 * 60 * 1000,
      'auto-approve-sprint'
    );
  });

  it('regression: scheduling a second sprint before the first fires cancels the stale job so the new sprint is not silently dropped', async () => {
    await scheduleAutoApprove('sprint-1', 'topic-1');
    await scheduleAutoApprove('sprint-2', 'topic-2');

    // cancelScheduledJob must be called before EVERY enqueue, including the second —
    // otherwise BullMQ would keep sprint-1's stale job/delay and sprint-2's
    // approval would never fire.
    expect(cancelScheduledJobMock).toHaveBeenCalledTimes(2);
    expect(enqueueScheduledJobMock).toHaveBeenCalledTimes(2);
    expect(enqueueScheduledJobMock).toHaveBeenLastCalledWith(
      'auto-approve-sprint',
      { sprintId: 'sprint-2', topicId: 'topic-2' },
      2 * 60 * 60 * 1000,
      'auto-approve-sprint'
    );

    // Redis pending-state key must reflect the LATEST sprint, not the first.
    expect(redisMock.set).toHaveBeenLastCalledWith(
      'sentinel:sprint:pending-auto-approve',
      JSON.stringify({ sprintId: 'sprint-2', topicId: 'topic-2' }),
      'PX', 2 * 60 * 60 * 1000
    );
  });

  it('cancelAutoApprove cancels both the Redis pending key and the queued BullMQ job', async () => {
    redisMock.get.mockResolvedValue(JSON.stringify({ sprintId: 'sprint-1', topicId: 'topic-1' }));
    const cancelled = await cancelAutoApprove();

    expect(cancelled).toBe(true);
    expect(redisMock.del).toHaveBeenCalledWith('sentinel:sprint:pending-auto-approve');
    expect(cancelScheduledJobMock).toHaveBeenCalledWith('auto-approve-sprint');
  });

  it('cancelAutoApprove returns false and does not touch the queue when nothing is pending', async () => {
    redisMock.get.mockResolvedValue(null);
    const cancelled = await cancelAutoApprove();

    expect(cancelled).toBe(false);
    expect(cancelScheduledJobMock).not.toHaveBeenCalled();
  });
});
