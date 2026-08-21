import logger from './logger';
import { Request, Response } from 'express';
import dbClient from './dbClient';
const { query } = dbClient;
import { getRedisConnection, getBuildPollQueue } from './queueClient';
import { getRuntimeState } from './runtimeState';

interface DependencySnapshot {
  services: Record<string, string>;
  queues: Record<string, unknown>;
  auditCycles: Record<string, unknown> | 'error';
}

async function collectDependencySnapshot(): Promise<DependencySnapshot> {
  const services: Record<string, string> = {
    notion: 'unchecked',
    telegram: 'unchecked',
    database: 'unchecked',
    redis: 'unchecked',
  };
  const queues: Record<string, unknown> = {
    buildPoll: 'unchecked',
  };
  let auditCycles: Record<string, unknown> | 'error' = 'error';

  try {
    const { Client } = require('@notionhq/client');
    const client = new Client({ auth: process.env['NOTION_API_KEY'] });
    await client.databases.retrieve({ database_id: process.env['NOTION_DATABASE_ID'] });
    services['notion'] = 'ok';
  } catch (err: any) {
    services['notion'] = 'error';
    logger.warn({ err: err.message }, 'Health: Notion error');
  }

  try {
    await query('SELECT 1');
    services['database'] = 'ok';
  } catch (err: any) {
    services['database'] = 'error';
    logger.warn({ err: err.message }, 'Health: DB error');
  }

  try {
    const conn = getRedisConnection();
    if (!conn) {
      services['redis'] = 'not_configured';
    } else {
      await conn.ping();
      services['redis'] = 'ok';
    }
  } catch (err: any) {
    services['redis'] = 'error';
    logger.warn({ err: err.message }, 'Health: Redis error');
  }

  services['telegram'] = (process.env['TELEGRAM_BOT_TOKEN'] && process.env['TELEGRAM_CHAT_ID'])
    ? 'configured'
    : 'not_configured';

  try {
    const queue = getBuildPollQueue();
    if (!queue) {
      queues['buildPoll'] = 'not_configured';
    } else {
      queues['buildPoll'] = await queue.getJobCounts();
    }
  } catch (_err: any) {
    queues['buildPoll'] = 'error';
  }

  try {
    const r = await query(`
      SELECT
        COUNT(*) FILTER (WHERE status='awaiting_approval') AS awaiting_approval,
        COUNT(*) FILTER (WHERE status='executing')         AS executing,
        COUNT(*) FILTER (WHERE status='complete'
          AND created_at > NOW() - INTERVAL '7 days')      AS completed_7d
      FROM audit_cycles
    `);
    auditCycles = r.rows[0] || {};
  } catch (_err: any) {
    auditCycles = 'error';
  }

  return { services, queues, auditCycles };
}

function buildHealthPayload(status: string, snapshot: DependencySnapshot): Record<string, unknown> {
  const runtime = getRuntimeState();
  return {
    status,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    phase: 3,
    dryRunMode: process.env['DEBUGGER_DRY_RUN'] === 'true',
    runtime,
    services: snapshot.services,
    queues: snapshot.queues,
    auditCycles: snapshot.auditCycles,
  };
}

function isReadinessBlocked(snapshot: DependencySnapshot): string | null {
  const runtime = getRuntimeState();
  if (runtime.status !== 'ready') {
    return runtime.error
      ? `runtime_${runtime.status}:${runtime.error}`
      : `runtime_${runtime.status}`;
  }
  if (snapshot.services['database'] !== 'ok') {
    return 'database_unavailable';
  }
  if (snapshot.services['redis'] === 'error') {
    return 'redis_unavailable';
  }
  if (snapshot.queues['buildPoll'] === 'error') {
    return 'build_poll_queue_unavailable';
  }
  return null;
}

export async function healthCheck(_req: Request, res: Response): Promise<void> {
  const snapshot = await collectDependencySnapshot();
  const degraded = snapshot.services['database'] !== 'ok'
    || snapshot.services['redis'] === 'error'
    || snapshot.queues['buildPoll'] === 'error';
  const payload = buildHealthPayload(degraded ? 'degraded' : 'ok', snapshot);
  res.status(200).json(payload);
}

export async function readinessCheck(_req: Request, res: Response): Promise<void> {
  const snapshot = await collectDependencySnapshot();
  const blockedBy = isReadinessBlocked(snapshot);
  const payload = buildHealthPayload(blockedBy ? 'not_ready' : 'ready', snapshot);

  if (blockedBy) {
    res.status(503).json({
      ...payload,
      blockedBy,
    });
    return;
  }

  res.status(200).json(payload);
}
