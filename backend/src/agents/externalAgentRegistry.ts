// Phase 4 of docs/2026-07-22-slack-agent-roster-plan.md — extensible
// external Slack-native agent roster (Kilo, Viktor, Devin, Manus,
// CodeRabbit, and future additions). The roster is DATA (this table), not
// code — adding agent #6 is an INSERT, not a new file. Every agent here is
// dispatched the same way: @mention it in the repo's Slack channel.
//
// Scope of this file: the DISPATCH half only (Sentinel -> agent). The
// REPLY-CORRELATION half (watching the channel for the agent's response and
// tying it back to a specific task) is a separate, larger piece — noted as
// not-yet-built in the plan doc rather than half-implemented here. This
// mirrors how Phase 1 shipped inbound and outbound Slack as genuinely
// separate increments rather than one large one.

import logger from '../logger';
import dbClient from '../dbClient';
import { sendSlackMessage } from '../slackClient';

const { query } = dbClient;

interface ExternalAgent {
  id: string;
  displayName: string;
  slackMention: string;
  role: 'worker' | 'auditor' | 'authority' | 'assistant';
  enabled: boolean;
}

async function initExternalAgentSchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS external_agents (
      id             TEXT PRIMARY KEY,
      display_name   TEXT NOT NULL,
      slack_mention  TEXT NOT NULL,
      role           TEXT NOT NULL,
      enabled        BOOLEAN NOT NULL DEFAULT true,
      added_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Seed the confirmed roster (round 2/4 design, corrected round 8 against
  // the owner's actual connected Slack apps — @Kilo/@Viktor/@Devin were
  // guessed capitalized from public docs; the real installed handles are
  // lowercase, and Claude/Codex/Hermes weren't in the original design at
  // all). display_name/slack_mention/role are updated on every startup so a
  // handle correction just needs a redeploy — `enabled` is deliberately
  // left out of the UPDATE so an operator's disable toggle survives.
  const seed: Array<[string, string, string, ExternalAgent['role']]> = [
    ['kilo',       'Kilo',       '@kilo',       'worker'],
    ['viktor',     'Viktor',     '@viktor',     'authority'],
    ['devin',      'Devin',      '@devin',      'worker'],
    ['manus',      'Manus',      '@manus',      'worker'],
    ['coderabbit', 'CodeRabbit', '@coderabbit', 'auditor'],
    ['claude',     'Claude',     '@claude',     'worker'],
    ['codex',      'Codex',      '@codex',      'worker'],
    ['hermes',     'Hermes',     '@hermes',     'assistant'],
    ['replit',     'Replit',     '@replit',     'worker'],
  ];
  for (const [id, displayName, slackMention, role] of seed) {
    await query(
      `INSERT INTO external_agents (id, display_name, slack_mention, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         slack_mention = EXCLUDED.slack_mention,
         role = EXCLUDED.role`,
      [id, displayName, slackMention, role]
    );
  }

  // Reply-correlation tracking — see dispatchToAgent()/recordAgentReply()
  // below. One row per dispatched task; a later Slack message.thread_ts
  // matching dispatch_ts is how a reply gets tied back to it.
  await query(`
    CREATE TABLE IF NOT EXISTS agent_dispatches (
      id                SERIAL PRIMARY KEY,
      agent_id          TEXT NOT NULL,
      repo_name         TEXT NOT NULL,
      task_description  TEXT NOT NULL,
      slack_channel_id  TEXT NOT NULL,
      dispatch_ts       TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'pending',
      reply_text        TEXT,
      replied_at        TIMESTAMPTZ,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_dispatches_channel_ts
      ON agent_dispatches (slack_channel_id, dispatch_ts);
  `);
}

async function getExternalAgent(agentId: string): Promise<ExternalAgent | null> {
  const r = await query(`SELECT * FROM external_agents WHERE id = $1`, [agentId]);
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.display_name,
    slackMention: row.slack_mention,
    role: row.role,
    enabled: row.enabled,
  };
}

async function listExternalAgents(opts: { enabledOnly?: boolean } = {}): Promise<ExternalAgent[]> {
  const r = await query(
    opts.enabledOnly
      ? `SELECT * FROM external_agents WHERE enabled = true ORDER BY id`
      : `SELECT * FROM external_agents ORDER BY id`
  );
  return r.rows.map((row: any) => ({
    id: row.id,
    displayName: row.display_name,
    slackMention: row.slack_mention,
    role: row.role,
    enabled: row.enabled,
  }));
}

/**
 * Dispatches a task to an external agent by @mentioning it in the given
 * repo's Slack channel. Returns the posted message's ts (Slack's own
 * message-identity/thread-reply-anchor field) so a later reply-correlation
 * pass (not built yet — see file header) has something to key off of.
 * Resolves null (does not throw) if the agent is unknown/disabled, or if
 * Slack delivery itself no-ops (unconfigured, no channel mapped) — same
 * safe-by-default posture as the rest of this Slack integration.
 */
async function dispatchToAgent(
  agentId: string,
  taskDescription: string,
  repoName: string
): Promise<{ ts: string } | null> {
  const agent = await getExternalAgent(agentId).catch((err: any) => {
    logger.error({ err: err.message, agentId }, 'External agent lookup failed');
    return null;
  });

  if (!agent) {
    logger.warn({ agentId }, 'Dispatch requested for unknown external agent');
    return null;
  }
  if (!agent.enabled) {
    logger.warn({ agentId }, 'Dispatch requested for a disabled external agent — skipping');
    return null;
  }

  const message = `${agent.slackMention} ${taskDescription}`;
  const result = await sendSlackMessage(message, repoName, null).catch((err: any) => {
    logger.error({ err: err.message, agentId, repoName }, 'Dispatch to external agent failed');
    return null;
  });

  const ts = result?.ts;
  const channelId = result?.channel;
  if (!ts || !channelId) {
    logger.debug({ agentId, repoName }, 'Dispatch did not produce a Slack message ts (likely unconfigured) — no-op');
    return null;
  }

  await query(
    `INSERT INTO agent_dispatches (agent_id, repo_name, task_description, slack_channel_id, dispatch_ts)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (slack_channel_id, dispatch_ts) DO NOTHING`,
    [agentId, repoName, taskDescription, channelId, ts]
  ).catch((err: any) => {
    // The Slack message itself already sent successfully — a tracking-row
    // failure shouldn't be reported as a dispatch failure, just logged, so
    // reply correlation degrades (silently un-trackable) rather than the
    // whole dispatch appearing to fail when it didn't.
    logger.error({ err: err.message, agentId, repoName, ts }, 'Failed to record agent_dispatches row — reply correlation for this dispatch will not work');
  });

  logger.info({ agentId, repoName, ts }, 'Dispatched task to external agent');
  return { ts };
}

/**
 * Called from slackEvents.ts when a plain `message` event (not
 * app_mention) arrives with a thread_ts — checks whether it's a reply to a
 * pending dispatch and, if so, marks it replied. No-op (not an error) if
 * the thread_ts doesn't match anything pending — most messages in a repo
 * channel aren't agent replies.
 */
async function recordAgentReply(channelId: string, threadTs: string, replyText: string): Promise<boolean> {
  const r = await query(
    `UPDATE agent_dispatches
     SET status = 'replied', reply_text = $3, replied_at = NOW()
     WHERE slack_channel_id = $1 AND dispatch_ts = $2 AND status = 'pending'
     RETURNING id, agent_id, repo_name`,
    [channelId, threadTs, replyText]
  );
  const updated = r.rows[0];
  if (updated) {
    logger.info({ agentId: updated.agent_id, repoName: updated.repo_name, dispatchId: updated.id },
      'Recorded external agent reply');
    return true;
  }
  return false;
}

export {
  initExternalAgentSchema,
  getExternalAgent,
  listExternalAgents,
  dispatchToAgent,
  recordAgentReply,
};
