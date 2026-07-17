import { ErrorCode, ErrorCodeMessages, isErrorCode } from './codes';

export interface ErrorContext {
  [key: string]: unknown;
}

export class SentinelError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly context: ErrorContext;
  public readonly isOperational: boolean;
  public readonly timestamp: string;
  public readonly errorCause?: Error;

  constructor(
    code: ErrorCode,
    message: string,
    context: ErrorContext = {},
    options: { statusCode?: number; isOperational?: boolean; errorCause?: Error } = {}
  ) {
    super(message);
    this.name = 'SentinelError';
    this.code = code;
    this.statusCode = options.statusCode ?? (ErrorCodeMessages[code] ? 500 : 500);
    this.context = context;
    this.isOperational = options.isOperational ?? true;
    this.timestamp = new Date().toISOString();
    this.errorCause = options.errorCause;

    Error.captureStackTrace(this, this.constructor);
  }

  toSentryJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      context: this.context,
      isOperational: this.isOperational,
      timestamp: this.timestamp,
      stack: this.stack,
      cause: this.errorCause?.message,
    };
  }
}

export class ValidationError extends SentinelError {
  constructor(message: string, context: ErrorContext = {}) {
    super(ErrorCode.VALIDATION_ERROR, message, context, { statusCode: 400 });
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends SentinelError {
  constructor(resource: string, id: string | number, context: ErrorContext = {}) {
    super(ErrorCode.NOT_FOUND, `${resource} not found: ${id}`, { ...context, resource, id }, { statusCode: 404 });
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends SentinelError {
  constructor(message = 'Unauthorized', context: ErrorContext = {}) {
    super(ErrorCode.UNAUTHORIZED, message, context, { statusCode: 401 });
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends SentinelError {
  constructor(message = 'Forbidden', context: ErrorContext = {}) {
    super(ErrorCode.FORBIDDEN, message, context, { statusCode: 403 });
    this.name = 'ForbiddenError';
  }
}

export class InternalError extends SentinelError {
  constructor(message: string, context: ErrorContext = {}, errorCause?: Error) {
    super(ErrorCode.INTERNAL_ERROR, message, context, { statusCode: 500, isOperational: false, errorCause });
    this.name = 'InternalError';
  }
}

export class BuilderError extends SentinelError {
  constructor(code: ErrorCode, message: string, context: ErrorContext = {}, errorCause?: Error) {
    super(code, message, context, { statusCode: 500, errorCause });
    this.name = 'BuilderError';
  }
}

export class AuditError extends SentinelError {
  constructor(code: ErrorCode, message: string, context: ErrorContext = {}, errorCause?: Error) {
    super(code, message, context, { statusCode: 500, errorCause });
    this.name = 'AuditError';
  }
}

export class AIProviderError extends SentinelError {
  constructor(code: ErrorCode, message: string, context: ErrorContext = {}, errorCause?: Error) {
    super(code, message, context, { statusCode: 502, errorCause });
    this.name = 'AIProviderError';
  }
}

export function toSentinelError(err: unknown, defaultCode = ErrorCode.INTERNAL_ERROR): SentinelError {
  if (err instanceof SentinelError) return err;
  if (err instanceof Error) {
    return new InternalError(err.message, {}, err);
  }
  return new InternalError(String(err), {});
}