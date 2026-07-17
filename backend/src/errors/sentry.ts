import * as Sentry from '@sentry/node';
import { SentinelError, toSentinelError } from './errorClasses';

export function initSentry(): void {
  const dsn = process.env['SENTRY_DSN'];
  const environment = process.env['NODE_ENV'] || 'development';

  if (!dsn) {
    console.warn('[Sentry] SENTRY_DSN not set — Sentry disabled');
    return;
  }

  Sentry.init({
    dsn,
    environment,
    tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
    profilesSampleRate: environment === 'production' ? 0.1 : 1.0,
    enableTracing: true,
    debug: environment !== 'production',
    beforeSend(event, hint) {
      const error = hint.originalException;
      if (error instanceof SentinelError) {
        event.tags = { ...event.tags, errorCode: error.code, isOperational: String(error.isOperational) };
        event.extra = { ...event.extra, context: error.context, errorTimestamp: error.timestamp };
        if (!error.isOperational) event.level = 'fatal';
      }
      return event;
    },
    ignoreErrors: [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNREFUSED',
      'EHOSTUNREACH',
      'EPIPE',
      'socket hang up',
    ],
  });

  console.log(`[Sentry] Initialized — environment: ${environment}`);
}

export function captureError(err: unknown, context?: Record<string, unknown>): string {
  const sentinelErr = toSentinelError(err);
  const eventId = Sentry.captureException(sentinelErr, { extra: context });
  return eventId;
}

export function captureMessage(message: string, level: Sentry.SeverityLevel = 'info', context?: Record<string, unknown>): string {
  return Sentry.captureMessage(message, { level, extra: context });
}

export function setUserContext(user: { id: string; email?: string; username?: string } | null): void {
  Sentry.setUser(user ?? null);
}

export function addBreadcrumb(breadcrumb: Sentry.Breadcrumb): void {
  Sentry.addBreadcrumb(breadcrumb);
}

export function startTransaction(name: string, op: string): void {
  Sentry.startSpan({ name, op }, () => {});
}

// Note: Express middleware removed in Sentry v8 - use expressIntegration instead if needed
// export const SentryMiddleware = Sentry.requestHandler();
// export const SentryErrorMiddleware = Sentry.errorHandler();