import { Worker, Queue } from 'bullmq';
import { getRedisConnection } from '../queueClient';
import { runSelfAudit } from '../selfAuditor';
import { checkAndHeal } from '../selfHealer';
import { generateSprintProposal } from '../sprintPlanner';
import { recordWeeklyVelocity } from '../velocityTracker';
import { getSprintStatus } from '../sprintOrchestrator';
import logger from '../logger';

const SENTINEL_TZ = process.env['SENTINEL_TIMEZONE'] || 'America/Toronto';

export function startSprintWorker(): Worker | null {
  const conn = getRedisConnection();
  if (!conn) {
    logger.warn('REDIS_URL not configured — sprint worker not started');
    return null;
  }

  const queue = new Queue('sprint', { connection: conn });

  // NOTE: `repeat` crons MUST NOT also pass a constant `jobId` — BullMQ dedupes
  // repeatable schedulers by (name + pattern) internally, but a constant
  // `jobId` collides with the retained completed job after the first fire,
  // making every subsequent schedule call a silent no-op. See autoApprover.ts
  // comment for the same trap in the delayed-job path.
  queue.add('propose', {}, {
    repeat: { pattern: '0 20 * * 0', tz: SENTINEL_TZ },
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule sprint proposal cron'));

  queue.add('midweek', {}, {
    repeat: { pattern: '0 9 * * 3', tz: SENTINEL_TZ },
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule sprint midweek cron'));

  queue.add('self-audit', {}, {
    repeat: { pattern: '0 21 * * 0', tz: SENTINEL_TZ },
  }).catch((err: any) => logger.warn({ err: err.message }, 'Could not schedule self-audit cron'));

  const worker = new Worker('sprint', async (job: any) => {
    if (job.name === 'propose') {
      await recordWeeklyVelocity();
      await generateSprintProposal();
    }
    if (job.name === 'midweek') {
      await getSprintStatus(null);
    }
    if (job.name === 'self-audit') {
      await runSelfAudit();
      await checkAndHeal();
    }
  }, { connection: conn });

  worker.on('failed', (job: any, err: Error) => {
    logger.error({ err: err.stack ?? err.message, job: job?.name }, 'Sprint worker job failed');
  });

  logger.info('Sprint worker started — proposes Sunday 8pm, mid-week update Wednesday 9am');
  return worker;
}
