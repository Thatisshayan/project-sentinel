const https   = require('https');
const logger  = require('./logger');

const MAX_LENGTH = 4096;

async function sendTelegramMessage(text) {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

  if (!BOT_TOKEN || !CHAT_ID) {
    logger.warn('Telegram credentials not configured — skipping message');
    return;
  }

  const safeText = text.length > MAX_LENGTH
    ? text.substring(0, MAX_LENGTH - 30) + '\n\n[message truncated]'
    : text;

  const body = JSON.stringify({
    chat_id:                  CHAT_ID,
    text:                     safeText,
    parse_mode:               'HTML',
    disable_web_page_preview: true,
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.telegram.org',
      path:     `/bot${BOT_TOKEN}/sendMessage`,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
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

    req.write(body);
    req.end();
  });
}

module.exports = { sendTelegramMessage };
