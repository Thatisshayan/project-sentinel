"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerDeadLetterEnqueuer = registerDeadLetterEnqueuer;
exports.safeFire = safeFire;
exports.fireAndForget = fireAndForget;
const logger_1 = __importDefault(require("../logger"));
const safeFireModule = { logger: logger_1.default, enqueueDeadLetter: null };
/** Wire the dead-letter enqueuer at runtime to avoid a static import cycle. */
function registerDeadLetterEnqueuer(fn) {
    safeFireModule.enqueueDeadLetter = fn;
}
function handleRejection(label, context, retryable, err) {
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    logger_1.default.error({ err: message, ...(context ?? {}) }, `safeFire: ${label} failed`);
    try {
        const { captureError } = require('../errors/sentry');
        captureError(err, { safeFireLabel: label, ...(context ?? {}) });
    }
    catch (sentryErr) {
        logger_1.default.warn({ err: sentryErr instanceof Error ? sentryErr.message : String(sentryErr) }, 'safeFire: Sentry capture skipped');
    }
    if (retryable && safeFireModule.enqueueDeadLetter) {
        try {
            safeFireModule.enqueueDeadLetter(label, { label, context, error: message });
        }
        catch (dlqErr) {
            logger_1.default.error({ err: dlqErr instanceof Error ? dlqErr.message : String(dlqErr) }, 'safeFire: failed to enqueue dead letter');
        }
    }
}
/**
 * Run a fire-and-forget promise (or zero-arg async fn) without swallowing
 * the error silently. Any rejection is logged (standard shape) and reported to
 * Sentry. Returns the original promise so callers may still `await` it when
 * they want suppress-and-continue semantics.
 */
function safeFire(promiseOrFn, options = {}) {
    const label = options.label ?? 'anonymous';
    const context = options.context;
    const retryable = options.retryable ?? false;
    const promise = typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn;
    return promise.catch((err) => {
        handleRejection(label, context, retryable, err);
        throw err; // re-throw so awaiters still see the rejection if they await
    });
}
/**
 * Fire-and-forget variant that does NOT re-throw — for true background calls
 * where the caller never awaits and must not crash on rejection.
 */
function fireAndForget(promiseOrFn, options = {}) {
    const label = options.label ?? 'anonymous';
    const context = options.context;
    const retryable = options.retryable ?? false;
    const promise = typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn;
    promise.catch((err) => {
        handleRejection(label, context, retryable, err);
    });
}
//# sourceMappingURL=safeFire.js.map