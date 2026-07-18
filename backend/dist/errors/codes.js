"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorCodeMessages = exports.ErrorCode = void 0;
exports.isErrorCode = isErrorCode;
var ErrorCode;
(function (ErrorCode) {
    // Configuration (1000-1099)
    ErrorCode["CONFIG_MISSING"] = "E_CONFIG_MISSING";
    ErrorCode["CONFIG_INVALID"] = "E_CONFIG_INVALID";
    ErrorCode["CONFIG_ENV_MISSING"] = "E_CONFIG_ENV_MISSING";
    // Database (1100-1199)
    ErrorCode["DB_CONNECTION_FAILED"] = "E_DB_CONNECTION_FAILED";
    ErrorCode["DB_QUERY_FAILED"] = "E_DB_QUERY_FAILED";
    ErrorCode["DB_SCHEMA_MISMATCH"] = "E_DB_SCHEMA_MISMATCH";
    ErrorCode["DB_MIGRATION_FAILED"] = "E_DB_MIGRATION_FAILED";
    // External APIs (1200-1299)
    ErrorCode["EXTERNAL_API_TIMEOUT"] = "E_EXTERNAL_API_TIMEOUT";
    ErrorCode["EXTERNAL_API_UNAVAILABLE"] = "E_EXTERNAL_API_UNAVAILABLE";
    ErrorCode["EXTERNAL_API_RATE_LIMITED"] = "E_EXTERNAL_API_RATE_LIMITED";
    ErrorCode["EXTERNAL_API_AUTH_FAILED"] = "E_EXTERNAL_API_AUTH_FAILED";
    ErrorCode["EXTERNAL_API_INVALID_RESPONSE"] = "E_EXTERNAL_API_INVALID_RESPONSE";
    // GitHub (1300-1399)
    ErrorCode["GITHUB_API_ERROR"] = "E_GITHUB_API_ERROR";
    ErrorCode["GITHUB_AUTH_FAILED"] = "E_GITHUB_AUTH_FAILED";
    ErrorCode["GITHUB_REPO_NOT_FOUND"] = "E_GITHUB_REPO_NOT_FOUND";
    ErrorCode["GITHUB_PR_CREATE_FAILED"] = "E_GITHUB_PR_CREATE_FAILED";
    ErrorCode["GITHUB_WEBHOOK_VERIFY_FAILED"] = "E_GITHUB_WEBHOOK_VERIFY_FAILED";
    // Notion (1400-1499)
    ErrorCode["NOTION_API_ERROR"] = "E_NOTION_API_ERROR";
    ErrorCode["NOTION_AUTH_FAILED"] = "E_NOTION_AUTH_FAILED";
    ErrorCode["NOTION_DATABASE_NOT_FOUND"] = "E_NOTION_DATABASE_NOT_FOUND";
    ErrorCode["NOTION_RATE_LIMITED"] = "E_NOTION_RATE_LIMITED";
    // Telegram (1500-1599)
    ErrorCode["TELEGRAM_API_ERROR"] = "E_TELEGRAM_API_ERROR";
    ErrorCode["TELEGRAM_AUTH_FAILED"] = "E_TELEGRAM_AUTH_FAILED";
    ErrorCode["TELEGRAM_MESSAGE_FAILED"] = "E_TELEGRAM_MESSAGE_FAILED";
    // AI Providers (1600-1699)
    ErrorCode["AI_PROVIDER_UNAVAILABLE"] = "E_AI_PROVIDER_UNAVAILABLE";
    ErrorCode["AI_PROVIDER_AUTH_FAILED"] = "E_AI_PROVIDER_AUTH_FAILED";
    ErrorCode["AI_PROVIDER_TIMEOUT"] = "E_AI_PROVIDER_TIMEOUT";
    ErrorCode["AI_PROVIDER_INVALID_RESPONSE"] = "E_AI_PROVIDER_INVALID_RESPONSE";
    ErrorCode["AI_PROVIDER_RATE_LIMITED"] = "E_AI_PROVIDER_RATE_LIMITED";
    ErrorCode["ALL_AI_PROVIDERS_FAILED"] = "E_ALL_AI_PROVIDERS_FAILED";
    // Builder/Aider (1700-1799)
    ErrorCode["BUILDER_NOT_FOUND"] = "E_BUILDER_NOT_FOUND";
    ErrorCode["BUILDER_TIMEOUT"] = "E_BUILDER_TIMEOUT";
    ErrorCode["BUILDER_EXECUTION_FAILED"] = "E_BUILDER_EXECUTION_FAILED";
    ErrorCode["BUILDER_NO_COMMIT"] = "E_BUILDER_NO_COMMIT";
    // Audit/Scanner (1800-1899)
    ErrorCode["AUDIT_SCAN_FAILED"] = "E_AUDIT_SCAN_FAILED";
    ErrorCode["AUDIT_PARSE_FAILED"] = "E_AUDIT_PARSE_FAILED";
    ErrorCode["AUDIT_VALIDATION_FAILED"] = "E_AUDIT_VALIDATION_FAILED";
    ErrorCode["SECURITY_SCAN_FAILED"] = "E_SECURITY_SCAN_FAILED";
    ErrorCode["DEPENDENCY_SCAN_FAILED"] = "E_DEPENDENCY_SCAN_FAILED";
    // Webhook/Payload (1900-1999)
    ErrorCode["WEBHOOK_VERIFICATION_FAILED"] = "E_WEBHOOK_VERIFICATION_FAILED";
    ErrorCode["WEBHOOK_PAYLOAD_INVALID"] = "E_WEBHOOK_PAYLOAD_INVALID";
    ErrorCode["WEBHOOK_PROCESSING_FAILED"] = "E_WEBHOOK_PROCESSING_FAILED";
    // Internal/Generic (9000-9999)
    ErrorCode["INTERNAL_ERROR"] = "E_INTERNAL_ERROR";
    ErrorCode["VALIDATION_ERROR"] = "E_VALIDATION_ERROR";
    ErrorCode["NOT_FOUND"] = "E_NOT_FOUND";
    ErrorCode["UNAUTHORIZED"] = "E_UNAUTHORIZED";
    ErrorCode["FORBIDDEN"] = "E_FORBIDDEN";
    ErrorCode["UNIMPLEMENTED"] = "E_UNIMPLEMENTED";
})(ErrorCode || (exports.ErrorCode = ErrorCode = {}));
exports.ErrorCodeMessages = {
    [ErrorCode.CONFIG_MISSING]: 'Required configuration is missing',
    [ErrorCode.CONFIG_INVALID]: 'Configuration value is invalid',
    [ErrorCode.CONFIG_ENV_MISSING]: 'Required environment variable is not set',
    [ErrorCode.DB_CONNECTION_FAILED]: 'Database connection failed',
    [ErrorCode.DB_QUERY_FAILED]: 'Database query failed',
    [ErrorCode.DB_SCHEMA_MISMATCH]: 'Database schema mismatch',
    [ErrorCode.DB_MIGRATION_FAILED]: 'Database migration failed',
    [ErrorCode.EXTERNAL_API_TIMEOUT]: 'External API request timed out',
    [ErrorCode.EXTERNAL_API_UNAVAILABLE]: 'External API is unavailable',
    [ErrorCode.EXTERNAL_API_RATE_LIMITED]: 'External API rate limit exceeded',
    [ErrorCode.EXTERNAL_API_AUTH_FAILED]: 'External API authentication failed',
    [ErrorCode.EXTERNAL_API_INVALID_RESPONSE]: 'External API returned invalid response',
    [ErrorCode.GITHUB_API_ERROR]: 'GitHub API error',
    [ErrorCode.GITHUB_AUTH_FAILED]: 'GitHub authentication failed',
    [ErrorCode.GITHUB_REPO_NOT_FOUND]: 'GitHub repository not found',
    [ErrorCode.GITHUB_PR_CREATE_FAILED]: 'Failed to create GitHub PR',
    [ErrorCode.GITHUB_WEBHOOK_VERIFY_FAILED]: 'GitHub webhook signature verification failed',
    [ErrorCode.NOTION_API_ERROR]: 'Notion API error',
    [ErrorCode.NOTION_AUTH_FAILED]: 'Notion authentication failed',
    [ErrorCode.NOTION_DATABASE_NOT_FOUND]: 'Notion database not found',
    [ErrorCode.NOTION_RATE_LIMITED]: 'Notion API rate limited',
    [ErrorCode.TELEGRAM_API_ERROR]: 'Telegram API error',
    [ErrorCode.TELEGRAM_AUTH_FAILED]: 'Telegram authentication failed',
    [ErrorCode.TELEGRAM_MESSAGE_FAILED]: 'Failed to send Telegram message',
    [ErrorCode.AI_PROVIDER_UNAVAILABLE]: 'AI provider unavailable',
    [ErrorCode.AI_PROVIDER_AUTH_FAILED]: 'AI provider authentication failed',
    [ErrorCode.AI_PROVIDER_TIMEOUT]: 'AI provider request timed out',
    [ErrorCode.AI_PROVIDER_INVALID_RESPONSE]: 'AI provider returned invalid response',
    [ErrorCode.AI_PROVIDER_RATE_LIMITED]: 'AI provider rate limited',
    [ErrorCode.ALL_AI_PROVIDERS_FAILED]: 'All AI providers failed',
    [ErrorCode.BUILDER_NOT_FOUND]: 'Builder tool not found in PATH',
    [ErrorCode.BUILDER_TIMEOUT]: 'Builder execution timed out',
    [ErrorCode.BUILDER_EXECUTION_FAILED]: 'Builder execution failed',
    [ErrorCode.BUILDER_NO_COMMIT]: 'Builder produced no commit',
    [ErrorCode.AUDIT_SCAN_FAILED]: 'Audit scan failed',
    [ErrorCode.AUDIT_PARSE_FAILED]: 'Failed to parse audit output',
    [ErrorCode.AUDIT_VALIDATION_FAILED]: 'Audit output validation failed',
    [ErrorCode.SECURITY_SCAN_FAILED]: 'Security scan failed',
    [ErrorCode.DEPENDENCY_SCAN_FAILED]: 'Dependency scan failed',
    [ErrorCode.WEBHOOK_VERIFICATION_FAILED]: 'Webhook signature verification failed',
    [ErrorCode.WEBHOOK_PAYLOAD_INVALID]: 'Webhook payload is invalid',
    [ErrorCode.WEBHOOK_PROCESSING_FAILED]: 'Webhook processing failed',
    [ErrorCode.INTERNAL_ERROR]: 'Internal server error',
    [ErrorCode.VALIDATION_ERROR]: 'Input validation failed',
    [ErrorCode.NOT_FOUND]: 'Resource not found',
    [ErrorCode.UNAUTHORIZED]: 'Unauthorized',
    [ErrorCode.FORBIDDEN]: 'Forbidden',
    [ErrorCode.UNIMPLEMENTED]: 'Feature not implemented',
};
function isErrorCode(code) {
    return Object.values(ErrorCode).includes(code);
}
//# sourceMappingURL=codes.js.map