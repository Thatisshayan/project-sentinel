"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const pino_1 = __importDefault(require("pino"));
const logger = (0, pino_1.default)({
    level: process.env['LOG_LEVEL'] || 'info',
    timestamp: pino_1.default.stdTimeFunctions.isoTime,
    formatters: {
        level(label) {
            return { level: label };
        },
    },
    redact: {
        paths: [
            'token', 'secret', 'key', 'password',
            'authorization', 'NOTION_API_KEY',
            'TELEGRAM_BOT_TOKEN', 'GITHUB_WEBHOOK_SECRET',
        ],
        censor: '[REDACTED]',
    },
});
module.exports = logger;
//# sourceMappingURL=logger.js.map