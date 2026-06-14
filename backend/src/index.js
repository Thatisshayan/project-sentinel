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
const { startBuildPollWorker, startDailyReportWorker, startSprintWorker, startAgentCleanupWorker } = require('./workers');

let checkAndOnboardNewRepos;
try { ({ checkAndOnboardNewRepos } = require('./repoOnboarder')); } catch {}

async function probeTools() {
  const { execSync } = require('child_process');
  const axios        = require('axios');

  // Check aider
  try {
    const v = execSync('aider --version 2>&1', { timeout: 8000 }).toString().trim();
    logger.info({ version: v }, 'Aider is available');
  } catch {
    logger.warn('Aider not found in PATH — builder tasks will fail');
    const { sendTelegramMessage } = require('./telegramClient');
    await sendTelegramMessage(
      'Project Sentinel WARNING: `aider` not found in PATH on this instance.\n' +
      'Builder tasks will fail until fixed. Check Railway deploy logs.',
      null, null
    ).catch(() => {});
  }

  // T15 — probe each configured AI provider (quick ping, non-blocking)
  const probes = [
    {
      name: 'NVIDIA NIM', key: 'NVIDIA_API_KEY',
      url:  'https://integrate.api.nvidia.com/v1/models',
      auth: () => `Bearer ${process.env.NVIDIA_API_KEY}`,
    },
    {
      name: 'Gemini',    key: 'GEMINI_API_KEY',
      url:  'https://generativelanguage.googleapis.com/v1beta/openai/models',
      auth: () => `Bearer ${process.env.GEMINI_API_KEY}`,
    },
    {
      name: 'DashScope (Qwen)', key: 'DASHSCOPE_API_KEY',
      url:  'https://dashscope.aliyuncs.com/compatible-mode/v1/models',
      auth: () => `Bearer ${process.env.DASHSCOPE_API_KEY}`,
    },
    {
      name: 'DeepSeek', key: 'DEEPSEEK_API_KEY',
      url:  'https://api.deepseek.com/models',
      auth: () => `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
  ];

  const results = [];
  for (const p of probes) {
    if (!process.env[p.key]) {
      results.push(`  ○ ${p.name}: key not set`);
      continue;
    }
    try {
      await axios.get(p.url, {
        headers: { Authorization: p.auth() },
        timeout: 6000,
      });
      results.push(`  ✓ ${p.name}: reachable`);
      logger.info({ provider: p.name }, 'AI provider reachable');
    } catch (err) {
      const status = err.response?.status;
      // 401/403 means key is wrong but endpoint is reachable; 200+ means OK
      if (status === 401 || status === 403) {
        results.push(`  ✗ ${p.name}: key invalid (${status})`);
      } else {
        results.push(`  ? ${p.name}: ${status || err.code || err.message}`);
      }
      logger.warn({ provider: p.name, status }, 'AI provider probe failed');
    }
  }

  logger.info({ results }, 'AI provider health check complete');
}

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
    await initConversationSchema();
    await probeTools();
    if (checkAndOnboardNewRepos) {
      await checkAndOnboardNewRepos().catch(err =>
        logger.warn({ err: err.message }, 'Repo onboarding check failed — non-blocking')
      );
    }
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
