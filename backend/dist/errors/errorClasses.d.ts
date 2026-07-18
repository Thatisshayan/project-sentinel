import { ErrorCode } from './codes';
export interface ErrorContext {
    [key: string]: unknown;
}
export declare class SentinelError extends Error {
    readonly code: ErrorCode;
    readonly statusCode: number;
    readonly context: ErrorContext;
    readonly isOperational: boolean;
    readonly timestamp: string;
    readonly errorCause?: Error;
    constructor(code: ErrorCode, message: string, context?: ErrorContext, options?: {
        statusCode?: number;
        isOperational?: boolean;
        errorCause?: Error;
    });
    toSentryJSON(): {
        name: string;
        code: ErrorCode;
        message: string;
        statusCode: number;
        context: ErrorContext;
        isOperational: boolean;
        timestamp: string;
        stack: string | undefined;
        cause: string | undefined;
    };
}
export declare class ValidationError extends SentinelError {
    constructor(message: string, context?: ErrorContext);
}
export declare class NotFoundError extends SentinelError {
    constructor(resource: string, id: string | number, context?: ErrorContext);
}
export declare class UnauthorizedError extends SentinelError {
    constructor(message?: string, context?: ErrorContext);
}
export declare class ForbiddenError extends SentinelError {
    constructor(message?: string, context?: ErrorContext);
}
export declare class InternalError extends SentinelError {
    constructor(message: string, context?: ErrorContext, errorCause?: Error);
}
export declare class BuilderError extends SentinelError {
    constructor(code: ErrorCode, message: string, context?: ErrorContext, errorCause?: Error);
}
export declare class AuditError extends SentinelError {
    constructor(code: ErrorCode, message: string, context?: ErrorContext, errorCause?: Error);
}
export declare class AIProviderError extends SentinelError {
    constructor(code: ErrorCode, message: string, context?: ErrorContext, errorCause?: Error);
}
export declare function toSentinelError(err: unknown, defaultCode?: ErrorCode): SentinelError;
//# sourceMappingURL=errorClasses.d.ts.map