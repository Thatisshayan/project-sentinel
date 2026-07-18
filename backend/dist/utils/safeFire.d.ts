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
/** Wire the dead-letter enqueuer at runtime to avoid a static import cycle. */
export declare function registerDeadLetterEnqueuer(fn: (task: string, payload: unknown) => Promise<unknown> | void): void;
/**
 * Run a fire-and-forget promise (or zero-arg async fn) without swallowing
 * the error silently. Any rejection is logged (standard shape) and reported to
 * Sentry. Returns the original promise so callers may still `await` it when
 * they want suppress-and-continue semantics.
 */
export declare function safeFire<T>(promiseOrFn: Promise<T> | (() => Promise<T>), options?: SafeFireOptions): Promise<T>;
/**
 * Fire-and-forget variant that does NOT re-throw — for true background calls
 * where the caller never awaits and must not crash on rejection.
 */
export declare function fireAndForget<T>(promiseOrFn: Promise<T> | (() => Promise<T>), options?: SafeFireOptions): void;
//# sourceMappingURL=safeFire.d.ts.map