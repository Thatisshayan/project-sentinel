require('dotenv').config();

const logger = require('./logger');
const { initSchema }           = require('./dbClient');
const { initAuditSchema }      = require('./auditDb');
const { initPortfolioSchema }  = require('./portfolioDb');
const { initSprintSchema }     = require('./sprintDb');
const { initAgentSchema }      = require('./agentDb');
const { initAgentPool }        = require('./agentRegistry');
const { initSelfAuditSchema }  = require('./selfAuditDb');
const { initDefaultPrompts }   = require('./promptOptimizer');
const { initBusinessSchema }   = require('./businessDb');
const { initSecuritySchema }   = require('./securityDb');
const { startBuildPollWorker, startDailyReportWorker, startSprintWorker, startAgentCleanupWorker } = require('./workers');

const REQUIRED = [
  // Phase 1 (required)
  'GITHUB_WEBHOOK_SECRET',
  'NOTION_API_KEY',
  'NOTION_DATABASE_ID',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
];
// Phase 2 vars (optional - will work without them but Phase 2 features disabled)
const PHASE2_VARS = [
  'GITHUB_TOKEN',
  'DATABASE_URL',
  'REDIS_URL',
  'DEBUGGER_SHARED_SECRET',
];

const missing = REQUIRED.filter(k => !process.env[k] || process.env[k].trim() === '');

if (missing.length > 0) {
  console.error('\n❌ SENTINEL STARTUP FAILED — Missing environment variables:\n');
  missing.forEach(k => console.error(`   • ${k}`));
  console.error('\nSet these in Railway Variables (production) or .env (local).\n');
  process.exit(1);
}

const missingPhase2 = PHASE2_VARS.filter(k => !process.env[k] || process.env[k].trim() === '');
if (missingPhase2.length > 0) {
  logger.warn({ missing: missingPhase2 }, 'Phase 2 environment variables not set — Phase 2 features disabled');
}

const express = require('express');
const app     = express();
const { handleCommand, handleCallbackQuery } = require('./telegramCommands');

app.use(express.json({ limit: '5mb' }));
app.set('trust proxy', 1);

app.use('/webhook', require('./webhook'));
app.get('/health',  require('./health'));

// Telegram webhook for /sentinel commands
app.post('/webhook/telegram', async (req, res) => {
  const expectedSecret = process.env.DEBUGGER_SHARED_SECRET;
  const secret = req.headers['x-telegram-bot-api-secret-token'];
  
  if (expectedSecret && secret !== expectedSecret) {
    logger.warn({ ip: req.ip }, 'Telegram webhook secret mismatch');
    return res.status(401).json({ error: 'Invalid secret' });
  }
  
  if (!expectedSecret) {
    logger.warn('DEBUGGER_SHARED_SECRET not set — skipping secret validation');
  }

  const cb = req.body.callback_query;
  if (cb) {
    await handleCallbackQuery(cb).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  const message = req.body.message || req.body.edited_message;
  if (!message || !message.text) {
    return res.status(200).json({ ok: true });
  }

  const chatId   = message.chat.id;
  const topicId  = message.message_thread_id || null;
  const fromName = message.from?.first_name || message.from?.username || 'User';

  try {
    await handleCommand(message.text, chatId, topicId, fromName, message);
  } catch (err) {
    logger.error({ err: err.message }, 'Telegram command handler error');
  }

  res.status(200).json({ ok: true });
});

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
    phase:   2,
  }, '🛡️ Sentinel backend started');
});

// Init database schema and start workers
(async () => {
  try {
    await initSchema();
    logger.info('Database schema ready');
    await initAuditSchema();
    logger.info('Audit schema ready');
    await initPortfolioSchema();
    logger.info('Portfolio schema ready');
    await initSprintSchema();
    logger.info('Sprint schema ready');
    await initAgentSchema();
    logger.info('Agent schema ready');
    await initSelfAuditSchema();
    logger.info('Self-audit schema ready');
    await initDefaultPrompts();
    logger.info('Prompts initialised');
    await initBusinessSchema();
    logger.info('Business intelligence schema ready');
    await initSecuritySchema();
    logger.info('Security schema ready');
    await initAgentPool();
    logger.info('Agent pool ready');
    startBuildPollWorker();
    startDailyReportWorker();
    startSprintWorker();
    startAgentCleanupWorker();
    logger.info('Workers started');
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to initialise Phase 2 components');
    // Do not crash — Phase 1 still works without Phase 2
  }
})();

process.on('unhandledRejection', (reason) => {
  logger.error({ reason: String(reason) }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  logger.error({ err: err.message }, 'Uncaught exception — shutting down');
  process.exit(1);
});
