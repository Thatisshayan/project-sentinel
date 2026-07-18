import { safeFire, fireAndForget, registerDeadLetterEnqueuer } from '../src/utils/safeFire';
import logger from '../src/logger';

// Mock the sentry module so the real @sentry/node (which hangs the Jest
// worker on this TS7 toolchain) is never loaded.
jest.mock('../src/errors/sentry', () => ({
  captureError: jest.fn(() => 'evt-mock'),
}));

import * as sentry from '../src/errors/sentry';

describe('safeFire / fireAndForget', () => {
  afterEach(() => jest.restoreAllMocks());

  it('safeFire: resolves and forwards the value when the promise succeeds', async () => {
    const result = await safeFire(Promise.resolve(42), { label: 'test' });
    expect(result).toBe(42);
  });

  it('safeFire: logs + reports to Sentry on rejection (does not swallow)', async () => {
    const loggerSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

    const boom = Promise.reject(new Error('kaboom'));
    await expect(safeFire(boom, { label: 'doThing', context: { repo: 'x' } })).rejects.toThrow('kaboom');

    expect(loggerSpy).toHaveBeenCalledTimes(1);
    const logged = loggerSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(logged['err']).toContain('kaboom');
    expect(logged['repo']).toBe('x');
    expect(sentry.captureError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ safeFireLabel: 'doThing' }));
  });

  it('fireAndForget: catches + logs without crashing the caller', async () => {
    const loggerSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

    fireAndForget(Promise.reject(new Error('bg fail')), { label: 'bg' });
    await new Promise((r) => setImmediate(r));

    expect(loggerSpy).toHaveBeenCalledTimes(1);
    expect((loggerSpy.mock.calls[0][0] as Record<string, unknown>)['err']).toContain('bg fail');
    expect(sentry.captureError).toHaveBeenCalled();
  });

  it('fireAndForget: does not reject the returned void (no unhandled rejection)', async () => {
    const loggerSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    const unhandled = jest.fn();
    process.once('unhandledRejection', unhandled);

    fireAndForget(Promise.reject(new Error('silent')), { label: 'silent' });
    await new Promise((r) => setImmediate(r));

    expect(unhandled).not.toHaveBeenCalled();
    expect(loggerSpy).toHaveBeenCalled();
    process.removeListener('unhandledRejection', unhandled);
  });

  it('routes retryable failures to the registered dead-letter enqueuer', async () => {
    const dlq = jest.fn().mockResolvedValue(undefined);
    registerDeadLetterEnqueuer(dlq);
    jest.spyOn(logger, 'error').mockImplementation(() => {});

    const boom = Promise.reject(new Error('retry me'));
    await expect(safeFire(boom, { label: 'dbWrite', retryable: true })).rejects.toThrow('retry me');

    expect(dlq).toHaveBeenCalledTimes(1);
    expect(dlq.mock.calls[0][0]).toBe('dbWrite');
    expect(sentry.captureError).toHaveBeenCalled();
  });

  it('does not route non-retryable failures to the dead-letter queue', async () => {
    const dlq = jest.fn().mockResolvedValue(undefined);
    registerDeadLetterEnqueuer(dlq);
    jest.spyOn(logger, 'error').mockImplementation(() => {});

    const boom = Promise.reject(new Error('one-off'));
    await expect(safeFire(boom, { label: 'metrics', retryable: false })).rejects.toThrow('one-off');

    expect(dlq).not.toHaveBeenCalled();
  });
});
