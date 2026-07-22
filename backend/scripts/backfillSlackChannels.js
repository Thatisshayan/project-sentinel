#!/usr/bin/env node
/**
 * One-off backfill: createChannelForRepo() (slackClient.ts) only runs
 * during NEW repo onboarding — repos onboarded before Slack existed have
 * no #reponame channel or slack_channels row. This creates them for every
 * repo already tracked in portfolio_metrics, using the exact same
 * naming/upsert logic as the real implementation (kept in sync by hand —
 * this is a standalone script, not a TS import, to avoid needing a full
 * build step to run it once).
 *
 * Usage: DATABASE_URL=<public proxy url> SLACK_BOT_TOKEN=<token> node scripts/backfillSlackChannels.js
 */

const { Client } = require('pg');
const https = require('https');

const BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('ERROR: SLACK_BOT_TOKEN required');
  process.exit(1);
}

function callSlackApi(method, payload) {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'slack.com',
      path: `/api/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${BOT_TOKEN}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const { rows: repos } = await client.query(
    `SELECT DISTINCT repo_name FROM portfolio_metrics ORDER BY repo_name`
  );
  const { rows: existing } = await client.query(`SELECT repo_name FROM slack_channels`);
  const existingSet = new Set(existing.map(r => r.repo_name));

  console.log(`${repos.length} tracked repos, ${existingSet.size} already have a Slack channel.`);

  for (const { repo_name } of repos) {
    const key = repo_name.toLowerCase();
    if (existingSet.has(key)) {
      console.log(`SKIP  ${repo_name} — already mapped`);
      continue;
    }

    const channelName = key.replace(/[^a-z0-9_-]/g, '-').slice(0, 80);
    let channelId = null;

    const created = await callSlackApi('conversations.create', { name: channelName });
    if (created.ok) {
      channelId = created.channel.id;
    } else if (created.error === 'name_taken') {
      const list = await callSlackApi('conversations.list', { limit: 1000 });
      const match = (list.channels || []).find(c => c.name === channelName);
      channelId = match ? match.id : null;
    } else {
      console.log(`FAIL  ${repo_name} — ${created.error}`);
      continue;
    }

    if (!channelId) {
      console.log(`FAIL  ${repo_name} — could not resolve a channel id`);
      continue;
    }

    await client.query(
      `INSERT INTO slack_channels (repo_name, channel_id) VALUES ($1, $2)
       ON CONFLICT (repo_name) DO UPDATE SET channel_id = EXCLUDED.channel_id`,
      [key, channelId]
    );
    console.log(`OK    ${repo_name} -> #${channelName} (${channelId})`);
  }

  await client.end();
}

main().catch((err) => {
  console.error('Backfill failed:', err.message);
  process.exit(1);
});
