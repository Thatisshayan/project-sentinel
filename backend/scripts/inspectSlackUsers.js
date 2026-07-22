#!/usr/bin/env node
/**
 * Read-only diagnostic: lists every member of the real Slack workspace
 * (via users.list) so external-agent bot user IDs (Viktor, Kilo, Manus,
 * etc.) can be identified with certainty instead of guessed. This is what
 * Phase 6 (viktorAuthority/viktorWatcher) needs for VIKTOR_SLACK_USER_ID —
 * the Slack MCP tool available in the coding session is connected to a
 * different workspace and has no visibility into this one.
 *
 * Read-only: makes no writes, no side effects. Safe to run repeatedly.
 * Usage: SLACK_BOT_TOKEN=<token> node scripts/inspectSlackUsers.js
 */

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

const ROSTER_HINTS = ['kilo', 'viktor', 'devin', 'manus', 'coderabbit', 'claude', 'codex', 'hermes', 'replit'];

async function main() {
  let cursor;
  const members = [];
  do {
    const res = await callSlackApi('users.list', { limit: 200, cursor });
    if (!res.ok) {
      console.error('users.list failed:', res.error);
      process.exit(1);
    }
    members.push(...res.members);
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);

  console.log(`${members.length} total workspace members (including bots, excluding deleted where Slack marks them).\n`);

  console.log('=== Roster-relevant matches (name/real_name contains a known agent handle) ===');
  for (const m of members) {
    if (m.deleted) continue;
    const haystack = `${m.name} ${m.real_name || ''} ${m.profile?.display_name || ''}`.toLowerCase();
    const hit = ROSTER_HINTS.find(h => haystack.includes(h));
    if (hit) {
      console.log(JSON.stringify({
        matched: hit, id: m.id, name: m.name, real_name: m.real_name,
        display_name: m.profile?.display_name, is_bot: m.is_bot, is_app_user: m.is_app_user,
      }));
    }
  }

  console.log('\n=== Full member list (id, name, real_name, is_bot) for manual cross-check ===');
  for (const m of members) {
    if (m.deleted) continue;
    console.log(`${m.id}\t${m.name}\t${m.real_name || ''}\t${m.is_bot}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
