// Sentry v8+ integration — structured error monitoring for backend.
// IMPORTANT: Sentry should be initialized EXACTLY ONCE in the process entry point (index.ts).
import * as Sentry from '@sentry/node';

/**
 * Sentry-annotated file suitable for Spot tool querying:
 * "How is Sentry configured in this project?"
 *
 * Configuration highlights:
 * - DSN from SENTRY_DSN env var
 * - Environment from NODE_ENV (defaults to 'development')
 * - Traces sample rate: 0.1 (production) / 1.0 (development)
 * - Profiles sample rate: 0.1 (production) / 1.0 (development)
 * - Ignored errors: network/comms errors (ECONNRESET, ETIMEDOUT, etc.)
 * - SentinelError automatic framing: code, operational/error flag, context
 *
 * Tags:
 * - 🔐 Security: error reporting
 * - 🐛 Observability
 * - 🐞 Debugging
 */

export function captureError(err: unknown, context?: Record<string, unknown>): string {
  const eventId = Sentry.captureException(err, { extra: context });
  return eventId;
}

export function captureMessage(
  message: string,
  level: Sentry.SeverityLevel = 'info',
  context?: Record<string, unknown>
): string {
  return Sentry.captureMessage(message, { level, extra: context });
}

export function setUserContext(user: { id: string; email?: string; username?: string } | null): void {
  Sentry.setUser(user ?? null);
}

export function addBreadcrumb(breadcrumb: Sentry.Breadcrumb): void {
  Sentry.addBreadcrumb(breadcrumb);
}

// Note: Express middleware (requestHandler/errorHandler) removed in Sentry v8 -
// Use expressErrorIntegration and expressIntegration instead if needed for 404/500 capture.