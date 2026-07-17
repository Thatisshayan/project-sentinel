import logger from '../logger';

export interface SafeFireOptions {
  /** Human-readable label used in logs/alerts, e.g. 'logAgentMessage'. */
  label?: string;
  /** Extra structured context attached to the log + Sentry event. */
  context?: Record<string, unknown>;
  /**
   * If true, a failed fire-and-forget is also routed to the dead-letter
   * queue (queueClient.enqueueDeadLetter) for later retry. Only set this for
   * operations that are safe + worth retrying (DB writes, telegram sends).
   * Defaults to false.
   */
  retryable?: boolean;
}

const safeFireModule = { logger, enqueueDeadLetter: null as null | ((task: string, payload: unknown) => Promise<unknown> | void) };

/** Wire the dead-letter enqueuer at runtime to avoid a static import cycle. */
export function registerDeadLetterEnqueuer(fn: (task: string, payload: unknown) => Promise<unknown> | void): void {
  safeFireModule.enqueueDeadLetter = fn;
}

function handleRejection(label: string, context: Record<string, unknown> | undefined, retryable: boolean, err: unknown): void {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  logger.error({ err: message, ...(context ?? {}) }, `safeFire: ${label} failed`);
  try {
    const { captureError } = require('../errors/sentry') as { captureError: (e: unknown, ctx?: Record<string, unknown>) => string };
    captureError(err, { safeFireLabel: label, ...(context ?? {}) });
  } catch (sentryErr) {
    logger.warn({ err: sentryErr instanceof Error ? sentryErr.message : String(sentryErr) }, 'safeFire: Sentry capture skipped');
  }
  if (retryable && safeFireModule.enqueueDeadLetter) {
    try {
      safeFireModule.enqueueDeadLetter(label, { label, context, error: message });
    } catch (dlqErr) {
      logger.error({ err: dlqErr instanceof Error ? dlqErr.message : String(dlqErr) }, 'safeFire: failed to enqueue dead letter');
    }
  }
}

/**
 * Run a fire-and-forget promise (or zero-arg async fn) without swallowing
 * the error silently. Any rejection is logged (standard shape) and reported to
 * Sentry. Returns the original promise so callers may still `await` it when
 * they want suppress-and-continue semantics.
 */
export function safeFire<T>(
  promiseOrFn: Promise<T> | (() => Promise<T>),
  options: SafeFireOptions = {}
): Promise<T> {
  const label = options.label ?? 'anonymous';
  const context = options.context;
  const retryable = options.retryable ?? false;

  const promise = typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn;
  return promise.catch((err: unknown) => {
    handleRejection(label, context, retryable, err);
    throw err; // re-throw so awaiters still see the rejection if they await
  }) as Promise<T>;
}

/**
 * Fire-and-forget variant that does NOT re-throw — for true background calls
 * where the caller never awaits and must not crash on rejection.
 */
export function fireAndForget<T>(
  promiseOrFn: Promise<T> | (() => Promise<T>),
  options: SafeFireOptions = {}
): void {
  const label = options.label ?? 'anonymous';
  const context = options.context;
  const retryable = options.retryable ?? false;

  const promise = typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn;
  promise.catch((err: unknown) => {
    handleRejection(label, context, retryable, err);
  });
}
