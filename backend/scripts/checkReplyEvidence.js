#!/usr/bin/env node
/**
 * Read-only diagnostic: checks for any real evidence that Slack has ever
 * delivered another app's message to this app's Events API subscription —
 * the single longest-standing unverified assumption in the plan doc.
 * Looks at agent_dispatches (Phase 4 reply correlation), agent_authority_log
 * (Phase 6 Viktor), and roundtable_sessions (Phase 7) for any row showing a
 * real recorded reply.
 *
 * Usage: DATABASE_URL=<public proxy url> node scripts/checkReplyEvidence.js
 */
const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  console.log('=== agent_dispatches (Phase 4) — any replied? ===');
  const dispatches = await client.query(
    `SELECT id, agent_id, repo_name, status, reply_text, replied_at, created_at
     FROM agent_dispatches ORDER BY created_at DESC LIMIT 20`
  );
  console.log(`${dispatches.rows.length} total dispatch rows (most recent 20 shown).`);
  console.table ? console.table(dispatches.rows) : console.log(JSON.stringify(dispatches.rows, null, 2));

  console.log('\n=== agent_authority_log (Phase 6, Viktor) — any entries at all? ===');
  const authLog = await client.query(`SELECT * FROM agent_authority_log ORDER BY created_at DESC LIMIT 20`);
  console.log(`${authLog.rows.length} rows.`);
  console.log(JSON.stringify(authLog.rows, null, 2));

  console.log('\n=== roundtable_sessions (Phase 7) — any responses recorded? ===');
  const rt = await client.query(`SELECT id, repo_name, question, agents_asked, agents_responded, status, created_at FROM roundtable_sessions ORDER BY created_at DESC LIMIT 20`);
  console.log(`${rt.rows.length} rows.`);
  console.log(JSON.stringify(rt.rows, null, 2));

  await client.end();
}

main().catch(err => { console.error(err); process.exit(1); });
