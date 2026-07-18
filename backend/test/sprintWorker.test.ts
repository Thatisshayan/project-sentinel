const queueAddMock = jest.fn().mockResolvedValue(undefined);
const workerOnMock = jest.fn();
let capturedProcessor: ((job: any) => Promise<void>) | undefined;

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: queueAddMock })),
  Worker: jest.fn().mockImplementation((_name: string, processor: any) => {
    capturedProcessor = processor;
    return { on: workerOnMock };
  }),
}));

const getRedisConnectionMock = jest.fn();
jest.mock('../src/queueClient', () => ({
  getRedisConnection: () => getRedisConnectionMock(),
}));

const runSelfAuditMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/selfAuditor', () => ({ runSelfAudit: () => runSelfAuditMock() }));

const checkAndHealMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/selfHealer', () => ({ checkAndHeal: () => checkAndHealMock() }));

const generateSprintProposalMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/sprintPlanner', () => ({ generateSprintProposal: () => generateSprintProposalMock() }));

const recordWeeklyVelocityMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/velocityTracker', () => ({ recordWeeklyVelocity: () => recordWeeklyVelocityMock() }));

const getSprintStatusMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/sprintOrchestrator', () => ({ getSprintStatus: (arg: any) => getSprintStatusMock(arg) }));

import { startSprintWorker } from '../src/workers/sprintWorker';

describe('startSprintWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedProcessor = undefined;
  });

  it('returns null and does not create a queue when Redis is not configured', () => {
    getRedisConnectionMock.mockReturnValue(null);
    const result = startSprintWorker();
    expect(result).toBeNull();
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it('schedules propose, midweek, and self-audit cron jobs when Redis is available', () => {
    getRedisConnectionMock.mockReturnValue({});
    startSprintWorker();

    const scheduledNames = queueAddMock.mock.calls.map((c) => c[0]);
    expect(scheduledNames).toEqual(['propose', 'midweek', 'self-audit']);

    const proposeOpts = queueAddMock.mock.calls[0][2];
    expect(proposeOpts.jobId).toBe('sprint-proposal-cron');
    expect(proposeOpts.repeat.pattern).toBe('0 20 * * 0');
  });

  it('propose job records weekly velocity then generates the sprint proposal', async () => {
    getRedisConnectionMock.mockReturnValue({});
    startSprintWorker();

    await capturedProcessor!({ name: 'propose' });
    expect(recordWeeklyVelocityMock).toHaveBeenCalledTimes(1);
    expect(generateSprintProposalMock).toHaveBeenCalledTimes(1);
  });

  it('midweek job fetches sprint status with no repo filter', async () => {
    getRedisConnectionMock.mockReturnValue({});
    startSprintWorker();

    await capturedProcessor!({ name: 'midweek' });
    expect(getSprintStatusMock).toHaveBeenCalledWith(null);
  });

  it('self-audit job runs self-audit then heal check', async () => {
    getRedisConnectionMock.mockReturnValue({});
    startSprintWorker();

    await capturedProcessor!({ name: 'self-audit' });
    expect(runSelfAuditMock).toHaveBeenCalledTimes(1);
    expect(checkAndHealMock).toHaveBeenCalledTimes(1);
  });

  it('registers a failed-job handler that logs without throwing', () => {
    getRedisConnectionMock.mockReturnValue({});
    startSprintWorker();

    expect(workerOnMock).toHaveBeenCalledWith('failed', expect.any(Function));
    const failedHandler = workerOnMock.mock.calls[0][1];
    expect(() => failedHandler({ name: 'propose' }, new Error('boom'))).not.toThrow();
  });
});
