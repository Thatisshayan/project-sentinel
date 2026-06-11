const logger  = require('./logger');

async function healthCheck(req, res) {
  const health = {
    status:     'ok',
    timestamp:  new Date().toISOString(),
    uptime:     Math.floor(process.uptime()),
    phase:      2,
    dryRunMode: process.env.DEBUGGER_DRY_RUN === 'true',
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
    const client = new Client({ auth: process.env.NOTION_API_KEY });
    await client.databases.retrieve({ database_id: process.env.NOTION_DATABASE_ID });
    health.services.notion = 'ok';
  } catch (err) {
    health.services.notion = 'error';
    logger.warn({ err: err.message }, 'Health: Notion error');
  }

  // Database
  try {
    const { query } = require('./dbClient');
    await query('SELECT 1');
    health.services.database = 'ok';
  } catch (err) {
    health.services.database = 'error';
    logger.warn({ err: err.message }, 'Health: DB error');
  }

  // Redis
  try {
    const { getRedisConnection } = require('./queueClient');
    const conn = getRedisConnection();
    await conn.ping();
    health.services.redis = 'ok';
  } catch (err) {
    health.services.redis = 'error';
    logger.warn({ err: err.message }, 'Health: Redis error');
  }

  // Telegram
  health.services.telegram = (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)
    ? 'configured'
    : 'not_configured';

  // Queue counts
  try {
    const { getBuildPollQueue } = require('./queueClient');
    const queue  = getBuildPollQueue();
    const counts = await queue.getJobCounts();
    health.queues.buildPoll = counts;
  } catch (err) {
    health.queues.buildPoll = 'error';
  }

  // Always return 200 - container is healthy if Express is running
  // Service dependencies reported in response but don't fail healthcheck
  res.status(200).json(health);
}

module.exports = healthCheck;