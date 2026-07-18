"use strict";
// Error Architecture — structured error taxonomy with metadata, Sentry integration, // and operational vs. programmer error distinction. Built following Node reference
// guidelines (Joyent) and `werror`/`verror` patterns.
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimitError = exports.WorkerError = exports.AgentError = exports.BuilderError = exports.AuditTaskError = exports.NotFoundError = exports.ConfigError = exports.WebhookError = exports.ValidationError = exports.AICallError = exports.DbError = exports.AppError = void 0;
// Base class for all application errors. Extends native Error and adds:
// - `code`: stable error identifier, safe for programmatic handling
// - `httpStatus`: recommended HTTP status code for API responses
// - `isOperational`: true for expected/recoverable errors, false for bugs
// Should NOT be instantiated directly — use a subclass.
class AppError extends Error {
    code;
    httpStatus;
    isOperational;
    context;
    constructor(message, code, httpStatus = 500, isOperational = true, context) {
        super(message);
        this.code = code;
        this.httpStatus = httpStatus;
        this.isOperational = isOperational;
        this.context = context;
        Error.captureStackTrace(this, this.constructor);
        this.name = this.constructor.name;
    }
}
exports.AppError = AppError;
/** Database errors — retry or escalate */
class DbError extends AppError {
    constructor(message, code = 'DB_ERROR') {
        super(message, code, 503); // Service Unavailable
    }
}
exports.DbError = DbError;
/** AI provider call failures (Claude, Gemini, DeepSeek, etc.) */
class AICallError extends AppError {
    provider;
    constructor(message, provider) {
        super(message, `AI_${provider.toUpperCase()}_ERROR`, 502); // Bad Gateway
        this.provider = provider;
    }
}
exports.AICallError = AICallError;
/** Input validation errors — client mistake */
class ValidationError extends AppError {
    constructor(message) {
        super(message, 'VALIDATION_ERROR', 400); // Bad Request
    }
}
exports.ValidationError = ValidationError;
/** Webhook signature/auth failures — client mistake */
class WebhookError extends AppError {
    constructor(message, code = 'WEBHOOK_ERROR') {
        super(message, code, 401); // Unauthorized
    }
}
exports.WebhookError = WebhookError;
/** Missing required configuration — deployment error */
class ConfigError extends AppError {
    constructor(key) {
        super(`Missing required config: ${key}`, 'CONFIG_ERROR', 500, false // Non-operational — deployment error (should crash process)
        );
    }
}
exports.ConfigError = ConfigError;
/** Entity not found errors — client mistake */
class NotFoundError extends AppError {
    constructor(entity) {
        super(`${entity} not found`, 'NOT_FOUND', 404); // Not Found
    }
}
exports.NotFoundError = NotFoundError;
/** Audit task failures — orchestration failures */
class AuditTaskError extends AppError {
    constructor(message, code = 'AUDIT_TASK_ERROR') {
        super(message, code, 500);
    }
}
exports.AuditTaskError = AuditTaskError;
/** Builder task failures (aider, Claude-code, etc.) */
class BuilderError extends AppError {
    constructor(message, code = 'BUILDER_ERROR') {
        super(message, code, 500);
    }
}
exports.BuilderError = BuilderError;
/** Agent lifecycle errors */
class AgentError extends AppError {
    constructor(message, code = 'AGENT_ERROR') {
        super(message, code, 500);
    }
}
exports.AgentError = AgentError;
/** Worker/background job failures */
class WorkerError extends AppError {
    constructor(message, code = 'WORKER_ERROR') {
        super(message, code, 500);
    }
}
exports.WorkerError = WorkerError;
/** Rate-limit errors */
class RateLimitError extends AppError {
    provider;
    constructor(message, provider) {
        super(message, 'RATE_LIMIT_ERROR', 429);
        this.provider = provider;
    }
}
exports.RateLimitError = RateLimitError;
//# sourceMappingURL=errors.js.map