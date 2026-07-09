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
const { initSecuritySchema }        = require('./securityDb');
const { initConversationSchema }    = require('./conversationMemory');
const { initSettingsSchema }   = require('./settingsDb');
const { startBuildPollWorker, startDailyReportWorker, startSprintWorker, startAgentCleanupWorker } = require('./workers');

let checkAndOnboardNewRepos;
try { ({ checkAndOnboardNewRepos } = require('./repoOnboarder')); } catch {}

let discoverAndOnboardRepos;
try { ({ discoverAndOnboardRepos } = require('./repoDiscovery')); } catch {}

async function probeTools() {
  const { execSync } = require('child_process');
  const { logAgentMessage } = require('./agentDb');

  // Check aider — log result to agent_messages so it appears in the UI
  try {
    const v = execSync('aider --version 2>&1', { timeout: 8000 }).toString().trim();
    logger.info({ version: v }, 'Aider is available');
    await logAgentMessage('sentinel', 'Sentinel', `Builder ready: ${v}`, 'info', null).catch(() => {});
  } catch {
    logger.warn('Aider not found in PATH — builder tasks will fail');
    await logAgentMessage('sentinel', 'Sentinel', 'WARNING: aider not found in PATH — builder tasks will fail. Check Railway deploy logs.', 'error', null).catch(() => {});
    const { sendTelegramMessage } = require('./telegramClient');
    await sendTelegramMessage(
      'Project Sentinel WARNING: `aider` not found in PATH on this instance.\n' +
      'Builder tasks will fail until fixed. Run /sentinel check-builder for details.',
      null, null
    ).catch(() => {});
  }

  // T15 — probe each configured AI provider at startup (quick ping, non-blocking).
  // Also re-run daily via the 'provider-health' job in workers.js so keys that
  // go bad mid-day (not just on deploy) get caught and surfaced as agent errors.
  const { probeAIProviders } = require('./providerHealthCheck');
  await probeAIProviders();
}

const REQUIRED = [
  // Phase 1 (required)
  'GITHUB_WEBHOOK_SECRET',
  'NOTION_API_KEY',
  'NOTION_DATABASE_ID',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'DEBUGGER_SHARED_SECRET',
  'GITHUB_ORG',
];
// Phase 2 vars (optional - will work without them but Phase 2 features disabled)
const PHASE2_VARS = [
  'GITHUB_TOKEN',
  'DATABASE_URL',
  'REDIS_URL',
];

const missing = REQUIRED.filter(k => !process.env[k] || process.env[k].trim() === '');

if (missing.length > 0) {
  logger.fatal({ missing }, 'SENTINEL STARTUP FAILED — missing required environment variables');
  missing.forEach(k => logger.fatal(`   • ${k}`));
  process.exit(1);
}

const missingPhase2 = PHASE2_VARS.filter(k => !process.env[k] || process.env[k].trim() === '');
if (missingPhase2.length > 0) {
  logger.warn({ missing: missingPhase2 }, 'Phase 2 environment variables not set — Phase 2 features disabled');
}

if (process.env.NODE_ENV === 'production' && !process.env.SENTINEL_UI_KEY?.trim()) {
  logger.fatal('SENTINEL STARTUP FAILED — SENTINEL_UI_KEY must be set in production to protect the UI API');
  process.exit(1);
}

const express = require('express');
const app     = express();
const { handleCommand, handleCallbackQuery } = require('./telegramCommands');

// Capture the raw request body bytes alongside the parsed JSON so webhook
// signature verification (e.g. GitHub's x-hub-signature-256) can HMAC the
// exact bytes that were sent instead of a re-serialized JS object, which
// would not reliably reproduce GitHub's signature (different whitespace/key
// order/escaping) and would cause valid webhooks to fail verification.
app.use(express.json({
  limit: '5mb',
  verify: (req, res, buf) => { req.rawBody = buf; },
}));
app.set('trust proxy', 1);

app.use('/webhook', require('./webhook'));
app.get('/health',  require('./health'));
app.use('/api',     require('./api'));

// Telegram webhook for /sentinel commands
app.post('/webhook/telegram', async (req, res) => {
  const expectedSecret = process.env.DEBUGGER_SHARED_SECRET;
  const secret = req.headers['x-telegram-bot-api-secret-token'];

  if (!expectedSecret) {
    logger.error({ ip: req.ip }, 'DEBUGGER_SHARED_SECRET not set — rejecting Telegram webhook');
    return res.status(401).json({ error: 'Webhook secret not configured on server' });
  }
  if (secret !== expectedSecret) {
    logger.warn({ ip: req.ip }, 'Telegram webhook secret mismatch');
    return res.status(401).json({ error: 'Invalid secret' });
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
    await initConversationSchema();
    await initSettingsSchema();
    logger.info('Settings schema ready');
    await probeTools();
    const { registerBotCommands } = require('./telegramClient');
    await registerBotCommands().catch(err =>
      logger.warn({ err: err.message }, 'Telegram command menu registration failed — non-blocking')
    );
    if (checkAndOnboardNewRepos) {
      await checkAndOnboardNewRepos().catch(err =>
        logger.warn({ err: err.message }, 'Repo onboarding check failed — non-blocking')
      );
    }
    if (discoverAndOnboardRepos) {
      await discoverAndOnboardRepos().catch(err =>
        logger.warn({ err: err.message }, 'Repo discovery failed — non-blocking')
      );
    }
    await initAgentPool();
    logger.info('Agent pool ready');
    startBuildPollWorker();
    startDailyReportWorker();
    startSprintWorker();
    startAgentCleanupWorker();
    logger.info('Workers started');

    // Reset tasks stuck in 'in_progress' from a previous deploy that was killed
    // mid-execution. Without this, tasks never return to 'queued' and the
    // pipeline stalls permanently after every Railway redeploy.
    const { query: dbCleanup } = require('./dbClient');
    const stale = await dbCleanup(`
      UPDATE audit_tasks SET status = 'queued', updated_at = NOW()
      WHERE status = 'in_progress'
      RETURNING id, repo_full_name
    `).catch(() => null);
    if (stale?.rows?.length) {
      logger.info({ count: stale.rows.length }, 'Startup: reset in_progress tasks to queued');
    }

    // Seed health metrics from GitHub API on startup so repos don't show 6.5 default
    const { syncAllRepoMetrics } = require('./githubMetricsSyncer');
    await syncAllRepoMetrics().catch(err =>
      logger.warn({ err: err.message }, 'Startup GitHub metrics sync failed — non-blocking')
    );
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
