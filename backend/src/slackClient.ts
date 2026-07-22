// Phase 1 of docs/2026-07-22-slack-agent-roster-plan.md — outbound Slack
// delivery. Deliberately NOT using @slack/bolt here — this file only needs
// to POST to Slack's Web API (chat.postMessage), the same raw-https style
// telegramClient.ts already uses for outbound sends. Bolt (or an Events API
// receiver) is a separate, later piece for *inbound* commands/mentions —
// this file only covers "Sentinel says something in Slack."
//
// Safe by construction when unconfigured: with no SLACK_BOT_TOKEN, or no
// slack_channels row for a given repo, sendSlackMessage() is a no-op that
// resolves null rather than throwing — so wiring this into
// sendTelegramMessage()'s existing ~150 call sites (see telegramClient.ts)
// changes nothing about current behavior until a real Slack app/token and
// channel mappings actually exist.

import https from 'https';
import logger from './logger';
import { retryWithBackoff } from './retry';
import dbClient from './dbClient';

const { query } = dbClient;

async function initSlackSchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS slack_channels (
      repo_name   TEXT PRIMARY KEY,
      channel_id  TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getSlackChannelId(repoName: string | null): Promise<string | null> {
  if (!repoName) return null;
  const r = await query(
    `SELECT channel_id FROM slack_channels WHERE repo_name = $1`,
    [repoName.toLowerCase()]
  );
  return r.rows[0]?.channel_id || null;
}

async function upsertSlackChannel(repoName: string, channelId: string): Promise<void> {
  await query(
    `INSERT INTO slack_channels (repo_name, channel_id) VALUES ($1, $2)
     ON CONFLICT (repo_name) DO UPDATE SET channel_id = EXCLUDED.channel_id`,
    [repoName.toLowerCase(), channelId]
  );
}

function postToSlackApi(botToken: string, payload: Record<string, any>): Promise<any> {
  const bodyJson = JSON.stringify(payload);
  return retryWithBackoff(
    () => new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'slack.com',
        path:     '/api/chat.postMessage',
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json; charset=utf-8',
          'Authorization':  `Bearer ${botToken}`,
          'Content-Length': Buffer.byteLength(bodyJson),
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk: any) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (!parsed.ok) {
              logger.error({ error: parsed.error }, 'Slack API returned error');
              reject(new Error(`Slack: ${parsed.error}`));
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
        reject(new Error('Slack request timed out after 10s'));
      });

      req.write(bodyJson);
      req.end();
    }),
    { maxRetries: 3, baseDelay: 1000 }
  );
}

function callSlackApi(botToken: string, method: string, payload: Record<string, any>): Promise<any> {
  const bodyJson = JSON.stringify(payload);
  return retryWithBackoff(
    () => new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'slack.com',
        path:     `/api/${method}`,
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json; charset=utf-8',
          'Authorization':  `Bearer ${botToken}`,
          'Content-Length': Buffer.byteLength(bodyJson),
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk: any) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (!parsed.ok) {
              reject(new Error(`Slack ${method}: ${parsed.error}`));
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
        reject(new Error(`Slack ${method} timed out after 10s`));
      });

      req.write(bodyJson);
      req.end();
    }),
    { maxRetries: 2, baseDelay: 500 }
  );
}

/**
 * Creates (or reuses, if a channel of that name already exists — Slack's
 * name_taken error is treated as success) a #<repoName> channel per the
 * naming convention in docs/2026-07-22-slack-agent-roster-plan.md — no
 * "sentinel-" prefix — and persists the mapping. Called during repo
 * onboarding (repoOnboarder.ts), same best-effort pattern as Notion-row and
 * GitHub-webhook creation there: never throws, resolves null on any
 * failure (including "not configured") so onboarding can report a partial
 * success rather than aborting.
 */
async function createChannelForRepo(repoName: string): Promise<string | null> {
  const BOT_TOKEN = process.env['SLACK_BOT_TOKEN'];
  if (!BOT_TOKEN) {
    logger.debug({ repoName }, 'Slack not configured — skipping channel creation');
    return null;
  }

  const channelName = repoName.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 80);

  try {
    const created = await callSlackApi(BOT_TOKEN, 'conversations.create', { name: channelName });
    const channelId = created.channel?.id;
    if (channelId) await upsertSlackChannel(repoName, channelId);
    return channelId || null;
  } catch (err: any) {
    // "name_taken" means the channel already exists — look it up instead
    // of treating this as a failure.
    if (String(err.message).includes('name_taken')) {
      try {
        const list = await callSlackApi(BOT_TOKEN, 'conversations.list', { limit: 1000 });
        const match = (list.channels || []).find((c: any) => c.name === channelName);
        if (match?.id) {
          await upsertSlackChannel(repoName, match.id);
          return match.id;
        }
      } catch (lookupErr: any) {
        logger.warn({ err: lookupErr.message, repoName }, 'Slack channel existed but lookup-after-name_taken failed');
      }
    } else {
      logger.warn({ err: err.message, repoName }, 'Slack channel creation failed');
    }
    return null;
  }
}

/**
 * Same signature shape as telegramClient's sendTelegramMessage (text,
 * repoName, optional thread pointer) so it can be called alongside it
 * without every existing call site needing to change. threadTs is Slack's
 * equivalent of Telegram's topicId — a thread_ts to reply within, or null
 * for a new top-level message.
 */
async function sendSlackMessage(
  text: string,
  repoName: string | null,
  threadTs?: string | null
): Promise<any> {
  const BOT_TOKEN = process.env['SLACK_BOT_TOKEN'];
  if (!BOT_TOKEN) {
    logger.debug('Slack not configured (SLACK_BOT_TOKEN unset) — skipping Slack message');
    return null;
  }

  const channelId = await getSlackChannelId(repoName).catch((err: any) => {
    logger.warn({ err: err.message, repoName }, 'Slack channel lookup failed — skipping Slack message');
    return null;
  });
  if (!channelId) {
    logger.debug({ repoName }, 'No Slack channel mapped for this repo — skipping Slack message');
    return null;
  }

  const payload: Record<string, any> = { channel: channelId, text };
  if (threadTs) payload['thread_ts'] = threadTs;

  return postToSlackApi(BOT_TOKEN, payload);
}

export = { initSlackSchema, sendSlackMessage, getSlackChannelId, upsertSlackChannel, createChannelForRepo };
