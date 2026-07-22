import https from 'https';
import logger from './logger';
import { loadSettings } from './settingsLoader';
import { retryWithBackoff } from './retry';
import { sendSlackMessage } from './slackClient';

const MAX_LENGTH = 4096;

// Topic ID mapping: repo name (lowercase) → Telegram topic ID
const TOPIC_MAP: Record<string, number> = {
  'project-sentinel':        parseInt(process.env['TOPIC_PROJECT_SENTINEL'] || '0', 10),
  'acc':                     parseInt(process.env['TOPIC_ACC'] || '0', 10),
  'alphonsoecosystem':       parseInt(process.env['TOPIC_ALPHONSOECOSYSTEM'] || '0', 10),
  'shiporex':                parseInt(process.env['TOPIC_SHIPOREX'] || '0', 10),
  'project-aegis-launch-site': parseInt(process.env['TOPIC_PROJECT_AEGIS'] || '0', 10),
  'tapcash':                 parseInt(process.env['TOPIC_TAPCASH'] || '0', 10),
  'sessionguard':            parseInt(process.env['TOPIC_SESSIONGUARD'] || '0', 10),
  'costpilot':               parseInt(process.env['TOPIC_COSTPILOT'] || '0', 10),
  'mint':                    parseInt(process.env['TOPIC_MINT'] || '0', 10),
  'obsidianstudio':          parseInt(process.env['TOPIC_OBSIDIANSTUDIO'] || '0', 10),
  'obsidianmedia':           parseInt(process.env['TOPIC_OBSIDIANMEDIA'] || '0', 10),
};

function getTopicId(repoName: string | null): number | null {
  const key = (repoName || '').toLowerCase();
  const topicId = TOPIC_MAP[key];
  return (topicId && topicId > 0) ? topicId : null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendTelegramMessage(
  text: string,
  repoName: string | null,
  explicitTopicId?: number | null,
  forceSend: boolean = false
): Promise<any> {
  const BOT_TOKEN = process.env['TELEGRAM_BOT_TOKEN'];
  const CHAT_ID   = process.env['TELEGRAM_CHAT_ID'];

  if (!BOT_TOKEN || !CHAT_ID) {
    logger.warn('Telegram credentials not configured — skipping message');
    return;
  }

  // Check if telegram alerts are enabled in settings (unless forceSend)
  if (!forceSend) {
    try {
      const settings = await loadSettings();
      if (!settings.telegram_alerts) {
        logger.debug('Telegram alerts disabled in settings');
        return;
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Could not check telegram alerts setting, sending anyway');
    }
  }

  const safeText = text.length > MAX_LENGTH
    ? text.substring(0, MAX_LENGTH - 30) + '\n\n[message truncated]'
    : text;

  // Phase 1 of docs/2026-07-22-slack-agent-roster-plan.md — "broadcast
  // everywhere": every Telegram send also fans out to Slack, independent of
  // whether the Telegram send itself succeeds. This is a no-op today (see
  // slackClient.ts header) until SLACK_BOT_TOKEN and slack_channels exist —
  // wiring it here means every one of this function's ~150 existing call
  // sites gets Slack delivery for free once those are configured, with zero
  // per-call-site changes. Deliberately not awaited — a Slack failure or
  // slowness must never delay or break the Telegram send.
  sendSlackMessage(safeText, repoName, null).catch((err: any) => {
    logger.warn({ err: err.message, repoName }, 'Slack fan-out failed (Telegram send unaffected)');
  });

  const escapedText = escapeHtml(safeText);

  const body: any = {
    chat_id:                  CHAT_ID,
    text:                     escapedText,
    parse_mode:               'HTML',
    disable_web_page_preview: true,
  };

  let topicId = explicitTopicId;
  if (!topicId && repoName) {
    topicId = getTopicId(repoName);
  }
  if (topicId) {
    body.message_thread_id = topicId;
  }

  const bodyJson = JSON.stringify(body);

  // Retry up to 3 times with exponential backoff on transient failures
  return retryWithBackoff(
    () => new Promise((resolve, reject) => {
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
        res.on('data',  (chunk: any) => { data += chunk; });
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
    }),
    { maxRetries: 3, baseDelay: 1000 }
  );
}

// Registers Telegram's native "/" command menu
async function registerBotCommands(): Promise<void> {
  const BOT_TOKEN = process.env['TELEGRAM_BOT_TOKEN'];
  if (!BOT_TOKEN) {
    logger.warn('TELEGRAM_BOT_TOKEN not set — skipping bot command menu registration');
    return;
  }

  const commands = [
    { command: 'start',    description: 'Open the Sentinel quick-actions menu' },
    { command: 'menu',     description: 'Open the Sentinel quick-actions menu' },
    { command: 'help',     description: 'Full command reference' },
    { command: 'sentinel', description: 'Run a Sentinel command, e.g. /sentinel health' },
  ];

  const bodyJson = JSON.stringify({ commands });

  // Retry up to 2 times with exponential backoff
  await retryWithBackoff(
    () => new Promise<void>((resolve) => {
      const options = {
        hostname: 'api.telegram.org',
        path:     `/bot${BOT_TOKEN}/setMyCommands`,
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(bodyJson),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk: any) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (!parsed.ok) {
              logger.warn({ desc: parsed.description }, 'setMyCommands failed');
            } else {
              logger.info('Telegram bot command menu registered');
            }
          } catch (e: any) {
            logger.warn({ err: e.message }, 'setMyCommands response parse failed');
          }
          resolve();
        });
      });

      req.on('error', (err: any) => {
        logger.warn({ err: err.message }, 'setMyCommands request failed');
        resolve();
      });

      req.setTimeout(10000, () => { req.destroy(); resolve(); });
      req.write(bodyJson);
      req.end();
    }),
    { maxRetries: 2, baseDelay: 500 }
  );
}

export = { sendTelegramMessage, getTopicId, registerBotCommands };
