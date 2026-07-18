"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIProviderError = exports.AuditError = exports.BuilderError = exports.InternalError = exports.ForbiddenError = exports.UnauthorizedError = exports.NotFoundError = exports.ValidationError = exports.SentinelError = void 0;
exports.toSentinelError = toSentinelError;
const codes_1 = require("./codes");
class SentinelError extends Error {
    code;
    statusCode;
    context;
    isOperational;
    timestamp;
    errorCause;
    constructor(code, message, context = {}, options = {}) {
        super(message);
        this.name = 'SentinelError';
        this.code = code;
        this.statusCode = options.statusCode ?? (codes_1.ErrorCodeMessages[code] ? 500 : 500);
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
exports.SentinelError = SentinelError;
class ValidationError extends SentinelError {
    constructor(message, context = {}) {
        super(codes_1.ErrorCode.VALIDATION_ERROR, message, context, { statusCode: 400 });
        this.name = 'ValidationError';
    }
}
exports.ValidationError = ValidationError;
class NotFoundError extends SentinelError {
    constructor(resource, id, context = {}) {
        super(codes_1.ErrorCode.NOT_FOUND, `${resource} not found: ${id}`, { ...context, resource, id }, { statusCode: 404 });
        this.name = 'NotFoundError';
    }
}
exports.NotFoundError = NotFoundError;
class UnauthorizedError extends SentinelError {
    constructor(message = 'Unauthorized', context = {}) {
        super(codes_1.ErrorCode.UNAUTHORIZED, message, context, { statusCode: 401 });
        this.name = 'UnauthorizedError';
    }
}
exports.UnauthorizedError = UnauthorizedError;
class ForbiddenError extends SentinelError {
    constructor(message = 'Forbidden', context = {}) {
        super(codes_1.ErrorCode.FORBIDDEN, message, context, { statusCode: 403 });
        this.name = 'ForbiddenError';
    }
}
exports.ForbiddenError = ForbiddenError;
class InternalError extends SentinelError {
    constructor(message, context = {}, errorCause) {
        super(codes_1.ErrorCode.INTERNAL_ERROR, message, context, { statusCode: 500, isOperational: false, errorCause });
        this.name = 'InternalError';
    }
}
exports.InternalError = InternalError;
class BuilderError extends SentinelError {
    constructor(code, message, context = {}, errorCause) {
        super(code, message, context, { statusCode: 500, errorCause });
        this.name = 'BuilderError';
    }
}
exports.BuilderError = BuilderError;
class AuditError extends SentinelError {
    constructor(code, message, context = {}, errorCause) {
        super(code, message, context, { statusCode: 500, errorCause });
        this.name = 'AuditError';
    }
}
exports.AuditError = AuditError;
class AIProviderError extends SentinelError {
    constructor(code, message, context = {}, errorCause) {
        super(code, message, context, { statusCode: 502, errorCause });
        this.name = 'AIProviderError';
    }
}
exports.AIProviderError = AIProviderError;
function toSentinelError(err, defaultCode = codes_1.ErrorCode.INTERNAL_ERROR) {
    if (err instanceof SentinelError)
        return err;
    if (err instanceof Error) {
        return new InternalError(err.message, {}, err);
    }
    return new InternalError(String(err), {});
}
//# sourceMappingURL=errorClasses.js.map