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
export declare function captureError(err: unknown, context?: Record<string, unknown>): string;
export declare function captureMessage(message: string, level?: Sentry.SeverityLevel, context?: Record<string, unknown>): string;
export declare function setUserContext(user: {
    id: string;
    email?: string;
    username?: string;
} | null): void;
export declare function addBreadcrumb(breadcrumb: Sentry.Breadcrumb): void;
//# sourceMappingURL=sentry.d.ts.map