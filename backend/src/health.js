const logger = require('./logger');

async function healthCheck(req, res) {
  const health = {
    status:    'ok',
    timestamp: new Date().toISOString(),
    uptime:    Math.floor(process.uptime()),
    phase:     1,
    services:  {
      notion:   'unchecked',
      telegram: 'unchecked',
    },
  };

  try {
    const { Client } = require('@notionhq/client');
    const client = new Client({ auth: process.env.NOTION_API_KEY });
    await client.databases.retrieve({ database_id: process.env.NOTION_DATABASE_ID });
    health.services.notion = 'ok';
  } catch (err) {
    health.services.notion = 'error';
    health.status = 'degraded';
    logger.warn({ err: err.message }, 'Health check: Notion unreachable');
  }

  health.services.telegram = (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)
    ? 'configured'
    : 'not_configured';

  if (health.services.telegram === 'not_configured') {
    health.status = 'degraded';
  }

  return res.status(health.status === 'ok' ? 200 : 503).json(health);
}

module.exports = healthCheck;
