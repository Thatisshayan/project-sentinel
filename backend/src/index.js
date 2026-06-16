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
      url:  `${process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'}/models`,
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
      if (status === 401 || status === 403) {
        results.push(`  ✗ ${p.name}: key invalid (${status})`);
      } else if (status === 400) {
        // 400 = bad request format, not an auth failure — key is likely valid
        results.push(`  ~ ${p.name}: endpoint format mismatch (key likely OK)`);
        logger.info({ provider: p.name }, 'AI provider 400 — key likely valid, /models unsupported');
      } else {
        results.push(`  ? ${p.name}: ${status || err.code || err.message}`);
      }
      logger.warn({ provider: p.name, status }, 'AI provider probe failed');
    }
  }

  logger.info({ results }, 'AI provider health check complete');

  // Alert on startup if any keys are definitely invalid (401/403)
  const invalidProviders = results.filter(r => r.includes('✗'));
  if (invalidProviders.length > 0) {
    const { sendTelegramMessage } = require('./telegramClient');
    await sendTelegramMessage(
      `🔴 Sentinel Startup — AI Provider Alert\n\n` +
      `${invalidProviders.length} provider(s) have invalid API keys:\n` +
      `${invalidProviders.join('\n')}\n\n` +
      `Go to Railway → Variables and update the key(s) to restore those agents.`,
      null, null
    ).catch(() => {});

    // Mark affected agents as error so the UI shows truth instead of idle
    const { markAgentError } = require('./agentDb');
    const PROVIDER_AGENT_MAP = {
      'NVIDIA NIM':       ['nvidia', 'qwen_coder', 'llama_fast'],
      'Gemini':           ['gemini'],
      'DashScope (Qwen)': ['qwen_coder_dash', 'qwen_max', 'qwen_turbo'],
      'DeepSeek':         ['deepseek'],
    };
    for (const line of invalidProviders) {
      const provider = line.match(/✗ (.+?):/)?.[1];
      for (const agentId of (PROVIDER_AGENT_MAP[provider] || [])) {
        await markAgentError(agentId, 'invalid_api_key').catch(() => {});
      }
    }
  }
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
