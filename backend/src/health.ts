import logger from './logger';
import { Request, Response } from 'express';
import dbClient from './dbClient';
const { query } = dbClient;
import { getRedisConnection, getBuildPollQueue } from './queueClient';

async function healthCheck(req: Request, res: Response): Promise<void> {
  const health: Record<string, any> = {
    status:     'ok',
    timestamp:  new Date().toISOString(),
    uptime:     Math.floor(process.uptime()),
    phase:      3,
    dryRunMode: process.env['DEBUGGER_DRY_RUN'] === 'true',
    services:   {
      notion:   'unchecked',
      telegram: 'unchecked',
      database: 'unchecked',
      redis:    'unchecked',
    },
    queues: {
      buildPoll: 'unchecked',
    },
  };

  // Notion
  try {
    const { Client } = require('@notionhq/client');
    const client = new Client({ auth: process.env['NOTION_API_KEY'] });
    await client.databases.retrieve({ database_id: process.env['NOTION_DATABASE_ID'] });
    health['services']['notion'] = 'ok';
  } catch (err: any) {
    health['services']['notion'] = 'error';
    logger.warn({ err: err.message }, 'Health: Notion error');
  }

  // Database
  try {
    await query('SELECT 1');
    health['services']['database'] = 'ok';
  } catch (err: any) {
    health['services']['database'] = 'error';
    logger.warn({ err: err.message }, 'Health: DB error');
  }

  // Redis
  try {
    const conn = getRedisConnection();
    if (!conn) {
      health['services']['redis'] = 'not_configured';
    } else {
      await conn.ping();
      health['services']['redis'] = 'ok';
    }
  } catch (err: any) {
    health['services']['redis'] = 'error';
    logger.warn({ err: err.message }, 'Health: Redis error');
  }

  // Telegram
  health['services']['telegram'] = (process.env['TELEGRAM_BOT_TOKEN'] && process.env['TELEGRAM_CHAT_ID'])
    ? 'configured'
    : 'not_configured';

  // Queue counts
  try {
    const queue = getBuildPollQueue();
    if (!queue) {
      health['queues']['buildPoll'] = 'not_configured';
    } else {
      const counts = await queue.getJobCounts();
      health['queues']['buildPoll'] = counts;
    }
  } catch (err: any) {
    health['queues']['buildPoll'] = 'error';
  }

  // Audit stats
  try {
    const r = await query(`
      SELECT
        COUNT(*) FILTER (WHERE status='awaiting_approval') AS awaiting_approval,
        COUNT(*) FILTER (WHERE status='executing')         AS executing,
        COUNT(*) FILTER (WHERE status='complete'
          AND created_at > NOW() - INTERVAL '7 days')      AS completed_7d
      FROM audit_cycles
    `);
    health['auditCycles'] = r.rows[0] || {};
  } catch (e: any) {
    health['auditCycles'] = 'error';
  }

  // Always return 200 - container is healthy if Express is running
  // Service dependencies reported in response but don't fail healthcheck
  res.status(200).json(health);
}

export = healthCheck;
