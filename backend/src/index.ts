import 'dotenv/config';
import express from 'express';
import logger from './logger';
import { initSchema } from './dbClient';
import { initAuditSchema } from './auditDb';
import { initPortfolioSchema } from './portfolioDb';
import { initSprintSchema } from './sprintDb';
import { initAgentSchema } from './agentDb';
import { initAgentPool } from './agentRegistry';
import { initSelfAuditSchema } from './selfAuditDb';
import { initDefaultPrompts } from './promptOptimizer';
import { initBusinessSchema } from './businessDb';
import { initSecuritySchema } from './securityDb';
import { initConversationSchema } from './conversationMemory';
import { initSettingsSchema } from './settingsDb';
import { initSelfScaler } from './selfScaler';
import { startBuildPollWorker, startDailyReportWorker, startSprintWorker, startAgentCleanupWorker } from './workers';
import { handleCommand, handleCallbackQuery } from './telegramCommands';

let checkAndOnboardNewRepos: (() => Promise<void>) | undefined;
try { ({ checkAndOnboardNewRepos } = require('./repoOnboarder') as any); } catch {}

let discoverAndOnboardRepos: (() => Promise<void>) | undefined;
try { ({ discoverAndOnboardRepos } = require('./repoDiscovery') as any); } catch {}

async function probeTools(): Promise<void> {
  const { execAsync } = require('./utils/execAsync');
  const { logAgentMessage } = require('./agentDb');

  try {
    const { stdout } = await execAsync('aider --version 2>&1', { timeout: 8000 });
    const v = stdout.trim();
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

  const { probeAIProviders } = require('./providerHealthCheck');
  await probeAIProviders();
}

const REQUIRED: string[] = [
  'GITHUB_WEBHOOK_SECRET',
  'NOTION_API_KEY',
  'NOTION_DATABASE_ID',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'DEBUGGER_SHARED_SECRET',
  'GITHUB_ORG',
];

const PHASE2_VARS: string[] = [
  'GITHUB_TOKEN',
  'DATABASE_URL',
  'REDIS_URL',
];

const missing = REQUIRED.filter(k => !process.env[k] || process.env[k]!.trim() === '');

if (missing.length > 0) {
  logger.fatal({ missing }, 'SENTINEL STARTUP FAILED — missing required environment variables');
  missing.forEach(k => logger.fatal(`   • ${k}`));
  process.exit(1);
}

const missingPhase2 = PHASE2_VARS.filter(k => !process.env[k] || process.env[k]!.trim() === '');
if (missingPhase2.length > 0) {
  logger.warn({ missing: missingPhase2 }, 'Phase 2 environment variables not set — Phase 2 features disabled');
}

if (process.env['NODE_ENV'] === 'production' && !process.env['SENTINEL_UI_KEY']?.trim()) {
  logger.fatal('SENTINEL STARTUP FAILED — SENTINEL_UI_KEY must be set in production to protect the UI API');
  process.exit(1);
}

const app = express();

interface RawBodyRequest extends express.Request {
  rawBody?: Buffer;
}

app.use(express.json({
  limit: '5mb',
  verify: (req: RawBodyRequest, _res: express.Response, buf: Buffer) => { req.rawBody = buf; },
}));
app.set('trust proxy', 1);

app.use('/webhook', require('./webhook'));
app.get('/health', require('./health'));
app.use('/api', require('./api'));

app.post('/webhook/telegram', async (req: express.Request, res: express.Response) => {
  const expectedSecret = process.env['DEBUGGER_SHARED_SECRET'];
  const secret = req.headers['x-telegram-bot-api-secret-token'] as string | undefined;

  if (!expectedSecret) {
    logger.error({ ip: req.ip }, 'DEBUGGER_SHARED_SECRET not set — rejecting Telegram webhook');
    return res.status(401).json({ error: 'Webhook secret not configured on server' });
  }
  if (secret !== expectedSecret) {
    logger.warn({ ip: req.ip }, 'Telegram webhook secret mismatch');
    return res.status(401).json({ error: 'Invalid secret' });
  }

  const cb = (req.body as any).callback_query;
  if (cb) {
    await handleCallbackQuery(cb).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  const message = (req.body as any).message || (req.body as any).edited_message;
  if (!message || !message.text) {
    return res.status(200).json({ ok: true });
  }

  const chatId: number = message.chat.id;
  const topicId: number | null = message.message_thread_id || null;
  const fromName: string = message.from?.first_name || message.from?.username || 'User';

  try {
    await handleCommand(message.text, chatId, topicId, fromName, message);
  } catch (err: any) {
    logger.error({ err: err.message }, 'Telegram command handler error');
  }

  res.status(200).json({ ok: true });
});

app.use((_req: express.Request, res: express.Response) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err: err.message, path: req.path }, 'Unhandled Express error');
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = parseInt(process.env['PORT'] || '3000', 10);

app.listen(PORT, () => {
  logger.info({
    port:    PORT,
    env:     process.env['NODE_ENV'] || 'development',
    phase:   2,
  }, '🛡️ Sentinel backend started');
});

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
    await initSelfScaler();
    logger.info('Self-scaler initialized');
    await probeTools();
    const { registerBotCommands } = require('./telegramClient');
    await registerBotCommands().catch((err: any) =>
      logger.warn({ err: err.message }, 'Telegram command menu registration failed — non-blocking')
    );
    if (checkAndOnboardNewRepos) {
      await checkAndOnboardNewRepos().catch((err: any) =>
        logger.warn({ err: err.message }, 'Repo onboarding check failed — non-blocking')
      );
    }
    if (discoverAndOnboardRepos) {
      await discoverAndOnboardRepos().catch((err: any) =>
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

    const { query: dbCleanup } = require('./dbClient');
    const stale = await dbCleanup(`
      UPDATE audit_tasks SET status = 'queued', updated_at = NOW()
      WHERE status = 'in_progress'
      RETURNING id, repo_full_name
    `).catch(() => null);
    if (stale?.rows?.length) {
      logger.info({ count: stale.rows.length }, 'Startup: reset in_progress tasks to queued');
    }

    const { syncAllRepoMetrics } = require('./githubMetricsSyncer');
    await syncAllRepoMetrics().catch((err: any) =>
      logger.warn({ err: err.message }, 'Startup GitHub metrics sync failed — non-blocking')
    );
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to initialise Phase 2 components');
  }
})();

process.on('unhandledRejection', (reason) => {
  logger.error({ reason: String(reason) }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (err: Error) => {
  logger.error({ err: err.message }, 'Uncaught exception — shutting down');
  process.exit(1);
});
