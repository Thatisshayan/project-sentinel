import logger from './logger';
import { safeFire, registerDeadLetterEnqueuer } from './utils/safeFire';
import { enqueueDeadLetter } from './queueClient';
import { initSchema } from './dbClient';
import { initAuditSchema } from './auditDb';
import { initBoardroomSchema } from './boardroomDb';
import { initPortfolioSchema } from './portfolioDb';
import { initProjectSchema } from './projectDb';
import { initMemorySchema } from './projectMemory';
import { initSprintSchema } from './sprintDb';
import { initAgentSchema } from './agentDb';
import { initSelfAuditSchema } from './selfAuditDb';
import { initDefaultPrompts } from './promptOptimizer';
import { initBusinessSchema } from './businessDb';
import { initSecuritySchema } from './securityDb';
import { initConversationSchema } from './conversationMemory';
import { initSettingsSchema } from './settingsDb';
import { initSlackSchema } from './slackClient';
import { initExternalAgentSchema } from './agents/externalAgentRegistry';
import { initViktorAuthoritySchema } from './viktorAuthority';
import { initRoundtableSchema } from './agents/roundtable';
import { initSelfScaler } from './selfScaler';
import { startBuildPollWorker, startDailyReportWorker, startSprintWorker, startAgentCleanupWorker, startScheduledJobsWorker } from './workers';

export async function runStartupProbe(): Promise<void> {
  const { execAsync } = require('./utils/execAsync');
  const { logAgentMessage } = require('./agentDb');

  try {
    const { stdout } = await execAsync('aider --version 2>&1', { timeout: 25000 });
    const v = stdout.trim();
    logger.info({ version: v }, 'Aider is available');
    await safeFire(logAgentMessage('sentinel', 'Sentinel', `Builder ready: ${v}`, 'info', null), { label: 'startup' });
  } catch (err: any) {
    const timedOut = err?.killed === true && err?.signal === 'SIGTERM';
    const reason = timedOut ? 'timed out after 25s (slow cold start?)' : (err?.message || 'unknown error');
    logger.warn({ reason }, 'Aider probe failed at boot — builder tasks may still work');
    await safeFire(logAgentMessage('sentinel', 'Sentinel', `WARNING: aider probe failed at boot (${reason}). Builder tasks may still work — this is a startup diagnostic, not a hard failure. Run /sentinel check-builder to verify.`, 'error', null), { label: 'startup' });
  }
}

export async function bootstrapRuntime(): Promise<void> {
  await initSchema();
  logger.info('Database schema ready');
  await initAuditSchema();
  await initBoardroomSchema();
  await initPortfolioSchema();
  await initProjectSchema();
  await initMemorySchema();
  await initSprintSchema();
  await initAgentSchema();
  await initSelfAuditSchema();
  await initDefaultPrompts();
  await initBusinessSchema();
  await initSecuritySchema();
  await initConversationSchema();
  await initSettingsSchema();
  await initSlackSchema();
  await initExternalAgentSchema();
  await initViktorAuthoritySchema();
  await initRoundtableSchema();
  await initSelfScaler();
  await runStartupProbe();
  const { registerBotCommands } = require('./telegramClient');
  await registerBotCommands().catch((err: any) => logger.warn({ err: err.message }, 'Telegram command menu registration failed — non-blocking'));
  await initAgentPoolSafe();
  startBuildPollWorker();
  startDailyReportWorker();
  startSprintWorker();
  startAgentCleanupWorker();
  startScheduledJobsWorker();
  registerDeadLetterEnqueuer(enqueueDeadLetter);
  const { query: dbCleanup } = require('./dbClient');
  await dbCleanup(`
      UPDATE audit_tasks SET status = 'queued', updated_at = NOW()
      WHERE status = 'in_progress'
      RETURNING id, repo_full_name
    `).catch(() => null);
}

async function initAgentPoolSafe(): Promise<void> {
  const { initAgentPool } = require('./agentRegistry');
  await initAgentPool();
}
