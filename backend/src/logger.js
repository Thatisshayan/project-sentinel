const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
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
