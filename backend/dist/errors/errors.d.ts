export declare class AppError extends Error {
    readonly code: string;
    readonly httpStatus: number;
    readonly isOperational: boolean;
    context?: Record<string, unknown> | undefined;
    constructor(message: string, code: string, httpStatus?: number, isOperational?: boolean, context?: Record<string, unknown> | undefined);
}
/** Database errors — retry or escalate */
export declare class DbError extends AppError {
    constructor(message: string, code?: string);
}
/** AI provider call failures (Claude, Gemini, DeepSeek, etc.) */
export declare class AICallError extends AppError {
    readonly provider: string;
    constructor(message: string, provider: string);
}
/** Input validation errors — client mistake */
export declare class ValidationError extends AppError {
    constructor(message: string);
}
/** Webhook signature/auth failures — client mistake */
export declare class WebhookError extends AppError {
    constructor(message: string, code?: string);
}
/** Missing required configuration — deployment error */
export declare class ConfigError extends AppError {
    constructor(key: string);
}
/** Entity not found errors — client mistake */
export declare class NotFoundError extends AppError {
    constructor(entity: string);
}
/** Audit task failures — orchestration failures */
export declare class AuditTaskError extends AppError {
    constructor(message: string, code?: string);
}
/** Builder task failures (aider, Claude-code, etc.) */
export declare class BuilderError extends AppError {
    constructor(message: string, code?: string);
}
/** Agent lifecycle errors */
export declare class AgentError extends AppError {
    constructor(message: string, code?: string);
}
/** Worker/background job failures */
export declare class WorkerError extends AppError {
    constructor(message: string, code?: string);
}
/** Rate-limit errors */
export declare class RateLimitError extends AppError {
    readonly provider: string;
    constructor(message: string, provider: string);
}
//# sourceMappingURL=errors.d.ts.map