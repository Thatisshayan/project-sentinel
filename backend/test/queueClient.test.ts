const addMock = jest.fn().mockResolvedValue({ id: 'job-1' });

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: addMock, getJob: jest.fn() })),
  Worker: jest.fn(),
  QueueEvents: jest.fn(),
}));

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
  }));
});

jest.mock('../src/telegramClient', () => ({
  sendTelegramMessage: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/dbClient', () => ({
  query: jest.fn(),
}));

jest.mock('../src/errors/sentry', () => ({
  captureError: jest.fn(() => 'evt-mock'),
}));

describe('queueClient dead-letter queue', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    addMock.mockClear();
    process.env = { ...ORIGINAL_ENV, REDIS_URL: 'redis://localhost:6379' };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('enqueues a dead-letter job with attempts:3 and exponential backoff when Redis is configured', async () => {
    const queueClient = require('../src/queueClient');
    const result = await queueClient.enqueueDeadLetter('dbWrite', { some: 'payload' });

    expect(addMock).toHaveBeenCalledTimes(1);
    const [name, data, opts] = addMock.mock.calls[0];
    expect(name).toBe('dbWrite');
    expect(data).toMatchObject({ task: 'dbWrite', payload: { some: 'payload' } });
    expect(data.failedAt).toEqual(expect.any(String));
    expect(opts).toMatchObject({ attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
    expect(result).toEqual({ id: 'job-1' });
  });

  it('returns null and does not throw when REDIS_URL is not configured', async () => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.REDIS_URL;
    const queueClient = require('../src/queueClient');

    const result = await queueClient.enqueueDeadLetter('dbWrite', { some: 'payload' });
    expect(result).toBeNull();
    expect(addMock).not.toHaveBeenCalled();
  });
});

describe('safeFire -> queueClient DLQ integration', () => {
  beforeEach(() => {
    jest.resetModules();
    addMock.mockClear();
    process.env = { ...ORIGINAL_ENV_2(), REDIS_URL: 'redis://localhost:6379' };
  });

  function ORIGINAL_ENV_2() {
    return process.env;
  }

  it('registerDeadLetterEnqueuer wired to the real queueClient.enqueueDeadLetter routes retryable failures through BullMQ', async () => {
    const { safeFire, registerDeadLetterEnqueuer } = require('../src/utils/safeFire');
    const queueClient = require('../src/queueClient');

    registerDeadLetterEnqueuer(queueClient.enqueueDeadLetter);

    const logger = require('../src/logger');
    jest.spyOn(logger, 'error').mockImplementation(() => {});

    const boom = Promise.reject(new Error('db write failed'));
    await expect(safeFire(boom, { label: 'roiScorer', retryable: true })).rejects.toThrow('db write failed');

    expect(addMock).toHaveBeenCalledTimes(1);
    expect(addMock.mock.calls[0][0]).toBe('roiScorer');
  });
});
