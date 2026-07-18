"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const safeFire_1 = require("./utils/safeFire");
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const errors_1 = require("./errors/errors");
const Sentry = __importStar(require("@sentry/node"));
const logger_1 = __importDefault(require("./logger"));
const timingSafeCompare_1 = require("./utils/timingSafeCompare");
const dbClient_1 = require("./dbClient");
const auditDb_1 = require("./auditDb");
const portfolioDb_1 = require("./portfolioDb");
const sprintDb_1 = require("./sprintDb");
const agentDb_1 = require("./agentDb");
const agentRegistry_1 = require("./agentRegistry");
const selfAuditDb_1 = require("./selfAuditDb");
const promptOptimizer_1 = require("./promptOptimizer");
const businessDb_1 = require("./businessDb");
const securityDb_1 = require("./securityDb");
const conversationMemory_1 = require("./conversationMemory");
const settingsDb_1 = require("./settingsDb");
const selfScaler_1 = require("./selfScaler");
const workers_1 = require("./workers");
const telegramCommands_1 = require("./telegramCommands");
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
            if (error instanceof errors_1.AppError) {
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
    logger_1.default.info('🔍 Sentry initialized');
}
else {
    logger_1.default.warn('🕵️ SENTRY_DSN not set — Sentry disabled');
}
let checkAndOnboardNewRepos;
try {
    ({ checkAndOnboardNewRepos } = require('./repoOnboarder'));
}
catch { }
let discoverAndOnboardRepos;
try {
    ({ discoverAndOnboardRepos } = require('./repoDiscovery'));
}
catch { }
async function probeTools() {
    const { execAsync } = require('./utils/execAsync');
    const { logAgentMessage } = require('./agentDb');
    try {
        const { stdout } = await execAsync('aider --version 2>&1', { timeout: 8000 });
        const v = stdout.trim();
        logger_1.default.info({ version: v }, 'Aider is available');
        await (0, safeFire_1.safeFire)(logAgentMessage('sentinel', 'Sentinel', `Builder ready: ${v}`, 'info', null), { label: 'index' });
    }
    catch {
        logger_1.default.warn('Aider not found in PATH — builder tasks will fail');
        await (0, safeFire_1.safeFire)(logAgentMessage('sentinel', 'Sentinel', 'WARNING: aider not found in PATH — builder tasks will fail. Check Railway deploy logs.', 'error', null), { label: 'index' });
        const { sendTelegramMessage } = require('./telegramClient');
        await (0, safeFire_1.safeFire)(sendTelegramMessage('Project Sentinel WARNING: `aider` not found in PATH on this instance.\n' +
            'Builder tasks will fail until fixed. Run /sentinel check-builder for details.', null, null), { label: 'index' });
    }
    const { probeAIProviders } = require('./providerHealthCheck');
    await probeAIProviders();
}
const REQUIRED = [
    'GITHUB_WEBHOOK_SECRET',
    'NOTION_API_KEY',
    'NOTION_DATABASE_ID',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
    'DEBUGGER_SHARED_SECRET',
    'GITHUB_ORG',
];
const PHASE2_VARS = [
    'GITHUB_TOKEN',
    'DATABASE_URL',
    'REDIS_URL',
];
const missing = REQUIRED.filter(k => !process.env[k] || process.env[k].trim() === '');
if (missing.length > 0) {
    logger_1.default.fatal({ missing }, 'SENTINEL STARTUP FAILED — missing required environment variables');
    missing.forEach(k => logger_1.default.fatal(`   • ${k}`));
    process.exit(1);
}
const missingPhase2 = PHASE2_VARS.filter(k => !process.env[k] || process.env[k].trim() === '');
if (missingPhase2.length > 0) {
    logger_1.default.warn({ missing: missingPhase2 }, 'Phase 2 environment variables not set — Phase 2 features disabled');
}
if (process.env['NODE_ENV'] === 'production' && !process.env['SENTINEL_UI_KEY']?.trim()) {
    logger_1.default.fatal('SENTINEL STARTUP FAILED — SENTINEL_UI_KEY must be set in production to protect the UI API');
    process.exit(1);
}
const app = (0, express_1.default)();
// Sentry v8+ Express integration
if (dsn) {
    (async () => {
        const sentryExpress = await import('@sentry/express');
        app.use(sentryExpress.expressIntegration());
    })();
}
app.use(express_1.default.json({
    limit: '5mb',
    verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.set('trust proxy', 1);
app.use('/webhook', require('./webhook'));
app.get('/health', require('./health'));
app.use('/api', require('./api'));
app.post('/webhook/telegram', async (req, res) => {
    const expectedSecret = process.env['DEBUGGER_SHARED_SECRET'];
    const secret = req.headers['x-telegram-bot-api-secret-token'];
    if (!expectedSecret) {
        logger_1.default.error({ ip: req.ip }, 'DEBUGGER_SHARED_SECRET not set — rejecting Telegram webhook');
        return res.status(401).json({ error: 'Webhook secret not configured on server' });
    }
    if (!(0, timingSafeCompare_1.timingSafeEqual)(secret || '', expectedSecret)) {
        logger_1.default.warn({ ip: req.ip }, 'Telegram webhook secret mismatch');
        return res.status(401).json({ error: 'Invalid secret' });
    }
    const cb = req.body.callback_query;
    if (cb) {
        await (0, safeFire_1.safeFire)((0, telegramCommands_1.handleCallbackQuery)(cb), { label: 'index' });
        return res.status(200).json({ ok: true });
    }
    const message = req.body.message || req.body.edited_message;
    if (!message || !message.text) {
        return res.status(200).json({ ok: true });
    }
    const chatId = message.chat.id;
    const topicId = message.message_thread_id || null;
    const fromName = message.from?.first_name || message.from?.username || 'User';
    try {
        await (0, telegramCommands_1.handleCommand)(message.text, chatId, topicId, fromName, message);
    }
    catch (err) {
        logger_1.default.error({ err: err.stack ?? err.message }, 'Telegram command handler error');
    }
    res.status(200).json({ ok: true });
});
app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
});
app.use(async (err, req, res, _next) => {
    // Advanced error normalization pipeline
    let appErr;
    let rawStack;
    if (err instanceof errors_1.AppError) {
        appErr = err; // Preserve taxonomy metadata
        rawStack = err.stack;
    }
    else if (err instanceof Error) {
        // Convert known error types to taxonomy
        if (err.message.includes('database'))
            appErr = new errors_1.DbError(err.message);
        else if (err.message.includes('validation'))
            appErr = new errors_1.ValidationError(err.message);
        else {
            // Default pathway — unexpected errors become non-operational
            appErr = new errors_1.AppError(err.message || "Unknown error occurred", "INTERNAL_SERVER_ERROR", 500, false // Non-operational — programmer error
            );
        }
        rawStack = err.stack;
    }
    else {
        // Primitive/unknown input — derive error message
        const errorMessage = typeof err === 'string' ? err : String(err);
        const context = typeof err === 'object' ? err : {};
        // Create structured operational error with embedded context
        appErr = new errors_1.AppError(errorMessage, "INTERNAL_SERVER_ERROR", 500, true // Operational — could retry
        );
        // Embed context directly into stack
        appErr.context = context ?? undefined;
    }
    // Pattern: dynamic context injection for Sentry
    const sentryConfig = {
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
    logger_1.default.debug({ eventId: _eventId }, '[Sentry] Event captured');
    const errorLog = {
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
        logger_1.default.warn(errorLog, '[Express] Operational error handled');
    }
    else {
        logger_1.default.error(errorLog, '[Express] PROGRAMMER ERROR — UNEXPECTED');
    }
    const response = {
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
    logger_1.default.info({
        port: PORT,
        env: process.env['NODE_ENV'] || 'development',
        phase: 2,
    }, '🛡️ Sentinel backend started');
});
(async () => {
    try {
        await (0, dbClient_1.initSchema)();
        logger_1.default.info('Database schema ready');
        await (0, auditDb_1.initAuditSchema)();
        logger_1.default.info('Audit schema ready');
        await (0, portfolioDb_1.initPortfolioSchema)();
        logger_1.default.info('Portfolio schema ready');
        await (0, sprintDb_1.initSprintSchema)();
        logger_1.default.info('Sprint schema ready');
        await (0, agentDb_1.initAgentSchema)();
        logger_1.default.info('Agent schema ready');
        await (0, selfAuditDb_1.initSelfAuditSchema)();
        logger_1.default.info('Self-audit schema ready');
        await (0, promptOptimizer_1.initDefaultPrompts)();
        logger_1.default.info('Prompts initialised');
        await (0, businessDb_1.initBusinessSchema)();
        logger_1.default.info('Business intelligence schema ready');
        await (0, securityDb_1.initSecuritySchema)();
        logger_1.default.info('Security schema ready');
        await (0, conversationMemory_1.initConversationSchema)();
        await (0, settingsDb_1.initSettingsSchema)();
        logger_1.default.info('Settings schema ready');
        await (0, selfScaler_1.initSelfScaler)();
        logger_1.default.info('Self-scaler initialized');
        await probeTools();
        const { registerBotCommands } = require('./telegramClient');
        await registerBotCommands().catch((err) => logger_1.default.warn({ err: err.message }, 'Telegram command menu registration failed — non-blocking'));
        if (checkAndOnboardNewRepos) {
            await checkAndOnboardNewRepos().catch((err) => logger_1.default.warn({ err: err.message }, 'Repo onboarding check failed — non-blocking'));
        }
        if (discoverAndOnboardRepos) {
            await discoverAndOnboardRepos().catch((err) => logger_1.default.warn({ err: err.message }, 'Repo discovery failed — non-blocking'));
        }
        await (0, agentRegistry_1.initAgentPool)();
        logger_1.default.info('Agent pool ready');
        (0, workers_1.startBuildPollWorker)();
        (0, workers_1.startDailyReportWorker)();
        (0, workers_1.startSprintWorker)();
        (0, workers_1.startAgentCleanupWorker)();
        logger_1.default.info('Workers started');
        const { query: dbCleanup } = require('./dbClient');
        const stale = await dbCleanup(`
      UPDATE audit_tasks SET status = 'queued', updated_at = NOW()
      WHERE status = 'in_progress'
      RETURNING id, repo_full_name
    `).catch(() => null);
        if (stale?.rows?.length) {
            logger_1.default.info({ count: stale.rows.length }, 'Startup: reset in_progress tasks to queued');
        }
        const { syncAllRepoMetrics } = require('./githubMetricsSyncer');
        await syncAllRepoMetrics().catch((err) => logger_1.default.warn({ err: err.message }, 'Startup GitHub metrics sync failed — non-blocking'));
    }
    catch (err) {
        logger_1.default.error({ err: err.stack ?? err.message }, 'Failed to initialise Phase 2 components');
    }
})();
// Centralized unhandled promise rejection handler
process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    // Structured logging for debugging
    const logPayload = {
        reason_string: String(reason),
        has_stack: err.stack !== undefined,
        stack: err.stack, // Full stack for debugging
        is_operational: err instanceof errors_1.AppError ? err.isOperational : undefined,
        error_code: err instanceof errors_1.AppError ? err.code : undefined,
        error_class: err.constructor?.name,
    };
    // Sentry reporting
    Sentry.captureException(err, {
        level: 'error',
        tags: { type: 'unhandled_rejection' },
        contexts: { metadata: logPayload },
    });
    // Core logging — redact large payloads
    logger_1.default.error({
        reason: err.message,
        stack: process.env['NODE_ENV'] === 'development' ? err.stack : "[REDACTED]",
        errorCode: err instanceof errors_1.AppError ? err.code : "UNKNOWN_ERROR",
        isOperational: err instanceof errors_1.AppError ? err.isOperational : undefined,
        hasStack: err.stack !== undefined,
    }, 'Unhandled promise rejection');
    // Crash on programmer errors (violates DiD principle — only safe here)
    if (err instanceof errors_1.AppError && !err.isOperational) {
        process.exit(1);
    }
});
// Centralized uncaught exception handler
process.on('uncaughtException', (err) => {
    // Structured field collection
    const logPayload = {
        message: err.message,
        stack: err.stack,
        name: err.name,
        code: err instanceof errors_1.AppError ? err.code : undefined,
        httpStatus: err instanceof errors_1.AppError ? err.httpStatus : undefined,
        isOperational: err instanceof errors_1.AppError ? err.isOperational : undefined,
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
    logger_1.default.fatal({
        err: err.message,
        code: err instanceof errors_1.AppError ? err.code : undefined,
        stack: err.stack ? err.stack.replace(/\n/g, '\n  ') : undefined, // Multi-line stack
        restarting: !(err instanceof errors_1.AppError && !err.isOperational), // Will restart if non-operational
    }, 'CRITICAL: Uncaught exception');
    // Always crash — process is compromised
    // Note: DiD violated here — only safe for uncaught exceptions (no recovery possible)
    process.exit(1);
});
//# sourceMappingURL=index.js.map