import 'dotenv/config';
import express from 'express';
import {
 AppError, DbError, AICallError, ValidationError, WebhookError,
 ConfigError, NotFoundError, AuditTaskError, BuilderError,
 AgentError, WorkerError, RateLimitError
} from './errors/errors';
import * as Sentry from '@sentry/node';
type SentryCaptureContext = Parameters<typeof Sentry.captureException>[1];
import logger from './logger';
import { timingSafeEqual } from './utils/timingSafeCompare';
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

const dsn = process.env['SENTRY_DSN'];
const environment = process.env['NODE_ENV'] || 'development';

if (dsn) {
  Sentry.init({
    dsn,
    environment,
    tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
    profilesSampleRate: environment === 'production' ? 0.1 : 1.0,
    enableTracing: true,
    debug: environment !== 'production',
    beforeSend(event, hint) {
      const error = hint.originalException;
      if (error instanceof AppError) {
        event.tags = {
          ...event.tags,
          errorCode: error.code,
          isOperational: String(error.isOperational)
        };
        event.extra = {
          ...event.extra,
          context: error.context,
        };
        if (!error.isOperational) {
          event.level = 'fatal';
        }
      }
      return event;
    },
    ignoreErrors: [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNREFUSED',
      'EHOSTUNREACH',
      'EPIPE',
      'socket hang up',
    ],
    integrations: [] // expressIntegration added later if express layer needed
  });
  logger.info('🔍 Sentry initialized');
} else {
  logger.warn('🕵️ SENTRY_DSN not set — Sentry disabled');
}

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

// Sentry v8+ Express integration
if (dsn) {
  (async () => {
    const sentryExpress = await import('@sentry/express');
    app.use(sentryExpress.expressIntegration());
  })();
}

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
  if (!timingSafeEqual(secret || '', expectedSecret)) {
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
    logger.error({ err: err.stack ?? err.message }, 'Telegram command handler error');
  }

  res.status(200).json({ ok: true });
});

app.use((_req: express.Request, res: express.Response) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(async (err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Advanced error normalization pipeline
  let appErr: AppError;
  let rawStack: string | undefined;
  
  if (err instanceof AppError) {
    appErr = err; // Preserve taxonomy metadata
    rawStack = err.stack;
  } else if (err instanceof Error) {
    // Convert known error types to taxonomy
    if (err.message.includes('database')) appErr = new DbError(err.message);
    else if (err.message.includes('validation')) appErr = new ValidationError(err.message);
    else {
      // Default pathway — unexpected errors become non-operational
      appErr = new AppError(
        err.message || "Unknown error occurred",
        "INTERNAL_SERVER_ERROR",
        500,
        false // Non-operational — programmer error
      );
    }
    rawStack = err.stack;
  } else {
    // Primitive/unknown input — derive error message
    const errorMessage = typeof err === 'string' ? err : String(err);
    const context = typeof err === 'object' ? err : {};
    
    // Create structured operational error with embedded context
    appErr = new AppError(
      errorMessage,
      "INTERNAL_SERVER_ERROR",
      500,
      true // Operational — could retry
    );
    // Embed context directly into stack
    appErr.context = (context as Record<string, unknown>) ?? undefined;
  }
  
  // Pattern: dynamic context injection for Sentry
  const sentryConfig: Parameters<typeof Sentry.captureException>[1] = {
    level: appErr.isOperational ? 'error' : 'fatal', // Operational errors recoverable; fatal = crash
    contexts: {
      request_metadata: {
        path: req.path,
        query_length: JSON.stringify(req.query).length, // Metadata without sensitive data
        method: req.method,
        ip: req.ip,
      },
      // Pattern: Error classifier — lets Sentry group by error taxonomies
      metadata: {
        error_taxonomy: {
          code: appErr.code,
          origin: err?.constructor?.name || typeof err,
          operational: appErr.isOperational,
        },
        // Pattern: runtime context shadowing — expose debug info only in dev
        environment: {
          process: {
            memory: process.memoryUsage(),
            uptime: process.uptime(),
          },
          environment: process.env['NODE_ENV'],
        },
        // Debug stack — redacted in production
        stack: process.env['NODE_ENV'] === 'development' && rawStack
          ? rawStack.split('\n').slice(0, 10) // Top ten stack frames
          : undefined,
      },
    },
    // Tagging for cross-central observability
    tags: {
      error_code: appErr.code,
      route_path: req.path,
      operational: String(appErr.isOperational),
      service: 'sentinel-backend',
    },
  };
  
  // Sentry capture — non-blocking
  const _eventId = Sentry.captureException(err ?? appErr, sentryConfig);
  logger.debug({ eventId: _eventId }, '[Sentry] Event captured');
  
  // Pattern: structured logging tier — convert error to observability-optimized format
  interface ErrorLogShape {
    error: string;
    code: string;
    route: string;
    severity: 'error' | 'fatal';
    // Pattern: redacted environment metadata
    environment?: {
      node_env: string;
      memory: ReturnType<typeof process.memoryUsage>;
      uptime: number;
    };
    stack_embed?: {
      sample: string;
      sampled_length: number;
    };
  }
  
  const errorLog: ErrorLogShape = {
    error: appErr.message,
    code: appErr.code,
    route: req.path,
    severity: appErr.isOperational ? 'error' : 'fatal',
    environment: {
      node_env: process.env['NODE_ENV'] || 'unknown',
      memory: process.memoryUsage(),
      uptime: process.uptime(),
    },
    // Pattern: sampled stack embedding
    stack_embed: rawStack && process.env['NODE_ENV'] !== 'production'
      ? {
          sample: rawStack.split('\n')[0] ?? 'no stack frame',
          sampled_length: rawStack.length,
        }
      : undefined,
  };
  
  if (appErr.isOperational) {
    logger.warn(errorLog, '[Express] Operational error handled');
  } else {
    logger.error(errorLog, '[Express] PROGRAMMER ERROR — UNEXPECTED');
  }
  
  // Response shaping — security-sensitive pattern
  interface ErrorResponseShape {
    error: string;
    errorCode: string;
    stack?: string[];
    retryable?: boolean;
  }
  
  const response: ErrorResponseShape = {
    error: appErr.message,
    errorCode: appErr.code,
    retryable: appErr.isOperational,
  };
  
  // Pattern: debug-only transparency
  if (process.env['NODE_ENV'] === 'development' && rawStack) {
    response.stack = rawStack.split('\n');
  }
  
  // Send response back to client
  res.status(appErr.httpStatus).json(response);
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
    logger.error({ err: err.stack ?? err.message }, 'Failed to initialise Phase 2 components');
  }
})();

// Centralized unhandled promise rejection handler
process.on('unhandledRejection', (reason: unknown) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  
  // Structured logging for debugging
  const logPayload: Record<string, unknown> = {
    reason_string: String(reason),
    has_stack: err.stack !== undefined,
    stack: err.stack, // Full stack for debugging
    is_operational: err instanceof AppError ? err.isOperational : undefined,
    error_code: err instanceof AppError ? err.code : undefined,
    error_class: err.constructor?.name,
  };
  
  // Sentry reporting
  Sentry.captureException(err, {
    level: 'error',
    tags: { type: 'unhandled_rejection' },
    contexts: { metadata: logPayload },
  });
  
  // Core logging — redact large payloads
  logger.error({
    reason: err.message,
    stack: process.env['NODE_ENV'] === 'development' ? err.stack : "[REDACTED]",
    errorCode: err instanceof AppError ? err.code : "UNKNOWN_ERROR",
    isOperational: err instanceof AppError ? err.isOperational : undefined,
    hasStack: err.stack !== undefined,
  }, 'Unhandled promise rejection');
  
  // Crash on programmer errors (violates DiD principle — only safe here)
  if (err instanceof AppError && !err.isOperational) {
    process.exit(1);
  }
});

// Centralized uncaught exception handler
process.on('uncaughtException', (err: Error) => {
  // Structured field collection
  const logPayload: Record<string, unknown> = {
    message: err.message,
    stack: err.stack,
    name: err.name,
    code: err instanceof AppError ? err.code : undefined,
    httpStatus: err instanceof AppError ? err.httpStatus : undefined,
    isOperational: err instanceof AppError ? err.isOperational : undefined,
  };
  
  // Sentry capture with comprehensive framing
  Sentry.captureException(err, {
    level: 'fatal', // Always severe — uncaught errors cannot be recovered
    tags: { type: 'uncaught_exception' },
    contexts: {
      error: logPayload,
      environment: {
        args: process.argv,
        env: "[REDACTED]",
        uptime: process.uptime(),
        arch: process.arch,
        platform: process.platform,
      },
    },
  });
  
  // High-severity logging with stack traces
  logger.fatal({
    err: err.message,
    code: err instanceof AppError ? err.code : undefined,
    stack: err.stack ? err.stack.replace(/\n/g, '\n  ') : undefined, // Multi-line stack
    restarting: !(err instanceof AppError && !err.isOperational), // Will restart if non-operational
  }, 'CRITICAL: Uncaught exception');
  
  // Always crash — process is compromised
  // Note: DiD violated here — only safe for uncaught exceptions (no recovery possible)
  process.exit(1);
});

