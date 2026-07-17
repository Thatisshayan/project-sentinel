// Error Architecture — structured error taxonomy with metadata, Sentry integration, // and operational vs. programmer error distinction. Built following Node reference
// guidelines (Joyent) and `werror`/`verror` patterns.

// Base class for all application errors. Extends native Error and adds:
// - `code`: stable error identifier, safe for programmatic handling
// - `httpStatus`: recommended HTTP status code for API responses
// - `isOperational`: true for expected/recoverable errors, false for bugs
// Should NOT be instantiated directly — use a subclass.
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus: number = 500,
    public readonly isOperational: boolean = true,
    public context?: Record<string, unknown>
  ) {
    super(message);
    Error.captureStackTrace(this, this.constructor);
    this.name = this.constructor.name;
  }
}

/** Database errors — retry or escalate */
export class DbError extends AppError {
  constructor(message: string, code: string = 'DB_ERROR') {
    super(message, code, 503); // Service Unavailable
  }
}

/** AI provider call failures (Claude, Gemini, DeepSeek, etc.) */
export class AICallError extends AppError {
  constructor(message: string, public readonly provider: string) {
    super(message, `AI_${provider.toUpperCase()}_ERROR`, 502); // Bad Gateway
  }
}

/** Input validation errors — client mistake */
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400); // Bad Request
  }
}

/** Webhook signature/auth failures — client mistake */
export class WebhookError extends AppError {
  constructor(message: string, code: string = 'WEBHOOK_ERROR') {
    super(message, code, 401); // Unauthorized
  }
}

/** Missing required configuration — deployment error */
export class ConfigError extends AppError {
  constructor(key: string) {
    super(
      `Missing required config: ${key}`,
      'CONFIG_ERROR',
      500,
      false // Non-operational — deployment error (should crash process)
    );
  }
}

/** Entity not found errors — client mistake */
export class NotFoundError extends AppError {
  constructor(entity: string) {
    super(`${entity} not found`, 'NOT_FOUND', 404); // Not Found
  }
}

/** Audit task failures — orchestration failures */
export class AuditTaskError extends AppError {
  constructor(message: string, code: string = 'AUDIT_TASK_ERROR') {
    super(message, code, 500);
  }
}

/** Builder task failures (aider, Claude-code, etc.) */
export class BuilderError extends AppError {
  constructor(message: string, code: string = 'BUILDER_ERROR') {
    super(message, code, 500);
  }
}

/** Agent lifecycle errors */
export class AgentError extends AppError {
  constructor(message: string, code: string = 'AGENT_ERROR') {
    super(message, code, 500);
  }
}

/** Worker/background job failures */
export class WorkerError extends AppError {
  constructor(message: string, code: string = 'WORKER_ERROR') {
    super(message, code, 500);
  }
}

/** Rate-limit errors */
export class RateLimitError extends AppError {
  constructor(message: string, public readonly provider: string) {
    super(message, 'RATE_LIMIT_ERROR', 429);
  }
}