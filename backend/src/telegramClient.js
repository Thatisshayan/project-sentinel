const https   = require('https');
const logger  = require('./logger');

const MAX_LENGTH = 4096;

// Topic ID mapping: repo name (lowercase) → Telegram topic ID
// Get topic IDs from Telegram: right-click a topic → "Copy ID" or use @RawDataBot
const TOPIC_MAP = {
  'project-sentinel':        parseInt(process.env.TOPIC_PROJECT_SENTINEL || '0', 10),
  'acc':                     parseInt(process.env.TOPIC_ACC || '0', 10),
  'alphonsoecosystem':       parseInt(process.env.TOPIC_ALPHONSOECOSYSTEM || '0', 10),
  'shiporex':                parseInt(process.env.TOPIC_SHIPOREX || '0', 10),
  'project-aegis-launch-site': parseInt(process.env.TOPIC_PROJECT_AEGIS || '0', 10),
  'tapcash':                 parseInt(process.env.TOPIC_TAPCASH || '0', 10),
  'sessionguard':            parseInt(process.env.TOPIC_SESSIONGUARD || '0', 10),
  'costpilot':               parseInt(process.env.TOPIC_COSTPILOT || '0', 10),
  'mint':                    parseInt(process.env.TOPIC_MINT || '0', 10),
  'obsidianstudio':          parseInt(process.env.TOPIC_OBSIDIANSTUDIO || '0', 10),
  'obsidianmedia':           parseInt(process.env.TOPIC_OBSIDIANMEDIA || '0', 10),
};

function getTopicId(repoName) {
  const key = (repoName || '').toLowerCase();
  const topicId = TOPIC_MAP[key];
  return (topicId && topicId > 0) ? topicId : null;
}

async function sendTelegramMessage(text, repoName) {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

  if (!BOT_TOKEN || !CHAT_ID) {
    logger.warn('Telegram credentials not configured — skipping message');
    return;
  }

  const safeText = text.length > MAX_LENGTH
    ? text.substring(0, MAX_LENGTH - 30) + '\n\n[message truncated]'
    : text;

  const body = {
    chat_id:                  CHAT_ID,
    text:                     safeText,
    parse_mode:               'HTML',
    disable_web_page_preview: true,
  };

  const topicId = getTopicId(repoName);
  if (topicId) {
    body.message_thread_id = topicId;
  }

  const bodyJson = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.telegram.org',
      path:     `/bot${BOT_TOKEN}/sendMessage`,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyJson),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data',  chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (!parsed.ok) {
            logger.error({ code: parsed.error_code, desc: parsed.description },
              'Telegram API returned error');
            reject(new Error(`Telegram: ${parsed.description}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);

    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Telegram request timed out after 10s'));
    });

    req.write(bodyJson);
    req.end();
  });
}

module.exports = { sendTelegramMessage, getTopicId };
