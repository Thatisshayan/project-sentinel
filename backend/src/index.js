require('dotenv').config();

const logger = require('./logger');

const REQUIRED = [
  'GITHUB_WEBHOOK_SECRET',
  'NOTION_API_KEY',
  'NOTION_DATABASE_ID',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
];

const missing = REQUIRED.filter(k => !process.env[k] || process.env[k].trim() === '');

if (missing.length > 0) {
  console.error('\n❌ SENTINEL STARTUP FAILED — Missing environment variables:\n');
  missing.forEach(k => console.error(`   • ${k}`));
  console.error('\nSet these in Railway Variables (production) or .env (local).\n');
  process.exit(1);
}

const express = require('express');
const app     = express();

app.use(express.json({ limit: '5mb' }));
app.set('trust proxy', 1);

app.use('/webhook', require('./webhook'));
app.get('/health',  require('./health'));

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  logger.error({ err: err.message, path: req.path }, 'Unhandled Express error');
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = parseInt(process.env.PORT || '3000', 10);

app.listen(PORT, () => {
  logger.info({
    port:    PORT,
    env:     process.env.NODE_ENV || 'development',
    phase:   1,
  }, '🛡️ Sentinel backend started');
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason: String(reason) }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  logger.error({ err: err.message }, 'Uncaught exception — shutting down');
  process.exit(1);
});
