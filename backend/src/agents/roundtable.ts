// Phase 7 of docs/2026-07-22-slack-agent-roster-plan.md — Bloome-style
// "roundtable": fan a question out to a repo's configured external agents
// in that repo's Slack channel, collect replies, and post an LLM-generated
// synthesis back into the same thread.
//
// HONESTY NOTE (explicit ask from the repo owner this session — read this
// before trusting anything below as "working"): none of this has been, or
// could be, tested against real Slack. There is no live multi-agent thread
// to verify against. Everything here is unit-tested against mocks only.
// Two real unknowns carry over, unresolved, from earlier phases:
//   1. Whether Slack's Events API actually delivers OTHER apps' bot
//      messages to this app's subscription at all — flagged since round 1
//      of the plan doc, still unverified. If it doesn't, nothing below
//      ever receives a reply, regardless of how correct this code is.
//   2. Reply attribution here is best-effort. A Slack `message` event for
//      a bot's reply doesn't reliably carry a stable per-agent identifier
//      this codebase can match against `agents_asked` — no external agent
//      has its own Slack bot user ID recorded anywhere in
//      `external_agents`. `recordRoundtableReply` stores whatever
//      identifying hint the event happens to carry (`username`, `bot_id`,
//      or `user`) rather than asserting a specific agent replied, and
//      "everyone answered" is approximated as "reply count >= agents
//      asked count", not a verified per-agent match.
//
// ALSO NOT BUILT: writing the roundtable outcome into the repo's living
// context document. That system (repoContextDoc.ts / CONTEXT.md, section
// 1.2 of the plan doc) does not exist anywhere in this codebase — checked
// before starting this phase, confirmed absent. The plan doc's Phase 7
// exit criteria mentions it; this is a real, acknowledged gap, not a
// stubbed function that pretends to do it.

import axios from 'axios';
import logger from '../logger';
import dbClient from '../dbClient';
import { sendSlackMessage } from '../slackClient';
import { listExternalAgents } from './externalAgentRegistry';
import { enqueueScheduledJob, cancelScheduledJob } from '../queueClient';
import { ROUNDTABLE_TIMEOUT_JOB } from '../workers/scheduledJobsWorker';

const { query } = dbClient;

const ROUNDTABLE_TIMEOUT_MIN = parseInt(process.env['ROUNDTABLE_TIMEOUT_MIN'] || '5');

interface RoundtableReply {
  hint: string;
  text: string;
  responded_at: string;
}

async function initRoundtableSchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS roundtable_sessions (
      id                 SERIAL PRIMARY KEY,
      repo_name          TEXT NOT NULL,
      question           TEXT NOT NULL,
      agents_asked       TEXT[] NOT NULL,
      agents_responded   JSONB NOT NULL DEFAULT '[]'::jsonb,
      synthesis          TEXT,
      status             TEXT NOT NULL DEFAULT 'pending',
      channel_id         TEXT NOT NULL,
      thread_ts          TEXT NOT NULL,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at       TIMESTAMPTZ,
      synthesizing_at    TIMESTAMPTZ
    );
  `);
  // CREATE TABLE IF NOT EXISTS above won't add synthesizing_at to a table
  // created before this column existed — installs that already had
  // roundtable_sessions would hit "column synthesizing_at does not exist"
  // the first time runRoundtableSynthesis ran. Confirmed as a real bug by
  // CodeRabbit (2026-07-29); safe to run unconditionally on every startup.
  await query(`
    ALTER TABLE roundtable_sessions ADD COLUMN IF NOT EXISTS synthesizing_at TIMESTAMPTZ;
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_roundtable_channel_ts
      ON roundtable_sessions (channel_id, thread_ts);
  `);
}

/**
 * Fans a question out to a repo's external agents by @mentioning all of
 * them in one Slack message in that repo's channel, records a
 * roundtable_sessions row keyed on the resulting message ts, and schedules
 * a timeout job that forces a synthesis even if not everyone replies.
 * If agentIds isn't given, defaults to every enabled 'worker'-role agent —
 * a deliberate simplification of the plan doc's per-question-type agent
 * selection idea (e.g. "+CodeRabbit for review, +Viktor for strategy"),
 * which isn't built. Resolves { ok:false, reason } rather than throwing
 * for any of the several ways this can legitimately not proceed (no
 * agents, Slack unconfigured, etc.) — same safe-by-construction posture as
 * dispatchToAgent().
 */
async function startRoundtable(
  repoName: string,
  question: string,
  agentIds?: string[]
): Promise<{ ok: boolean; reason?: string; sessionId?: number }> {
  const roster = await listExternalAgents({ enabledOnly: true }).catch(() => []);

  let ids = agentIds;
  if (!ids || ids.length === 0) {
    ids = roster.filter(a => a.role === 'worker').map(a => a.id);
  }
  if (ids.length === 0) {
    return { ok: false, reason: 'no agent ids given and no enabled worker agents to default to' };
  }

  const mentions = ids
    .map(id => roster.find(a => a.id === id)?.slackMention)
    .filter((m): m is string => !!m);
  if (mentions.length === 0) {
    return { ok: false, reason: 'none of the requested agent ids are known/enabled' };
  }

  const message = `🗣️ Roundtable: ${mentions.join(' ')} — ${question}`;
  const result = await sendSlackMessage(message, repoName, null).catch((err: any) => {
    logger.error({ err: err.message, repoName }, 'Roundtable fan-out Slack post failed');
    return null;
  });

  const ts = result?.ts;
  const channelId = result?.channel;
  if (!ts || !channelId) {
    return { ok: false, reason: 'Slack delivery did not produce a message ts (likely unconfigured — no SLACK_BOT_TOKEN or no channel mapped for this repo)' };
  }

  const insert = await query(
    `INSERT INTO roundtable_sessions (repo_name, question, agents_asked, channel_id, thread_ts)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (channel_id, thread_ts) DO NOTHING
     RETURNING id`,
    [repoName, question, ids, channelId, ts]
  );
  const sessionId = insert.rows[0]?.id;
  if (!sessionId) {
    logger.error({ repoName, ts }, 'Failed to record roundtable_sessions row — replies will not be correlated for this roundtable');
    return { ok: false, reason: 'failed to record roundtable session row' };
  }

  await enqueueScheduledJob(
    ROUNDTABLE_TIMEOUT_JOB,
    { sessionId },
    ROUNDTABLE_TIMEOUT_MIN * 60 * 1000,
    `roundtable-timeout:${sessionId}`
  ).catch((err: any) => {
    logger.error({ err: err.message, sessionId }, 'Failed to schedule roundtable timeout job — session will only complete if replies happen to cover everyone asked');
  });

  logger.info({ sessionId, repoName, agentIds: ids }, 'Roundtable started');
  return { ok: true, sessionId };
}

/**
 * Called from slackEvents.ts's plain `message` handler, alongside (not
 * instead of) the existing recordAgentReply() call for Phase 4's
 * single-agent dispatch correlation — a channel can have both kinds of
 * pending threads at once. Safe no-op (returns false) when the thread_ts
 * doesn't match a pending roundtable session.
 */
async function recordRoundtableReply(
  channelId: string,
  threadTs: string,
  event: { text?: string; username?: string; bot_id?: string; user?: string }
): Promise<boolean> {
  if (typeof event.text !== 'string') return false;

  const r = await query(
    `SELECT id, agents_asked, agents_responded FROM roundtable_sessions
     WHERE channel_id = $1 AND thread_ts = $2 AND status = 'pending'`,
    [channelId, threadTs]
  );
  const session = r.rows[0];
  if (!session) return false;

  const hint = event.username || event.bot_id || event.user || 'unknown';
  const newReply: RoundtableReply = { hint, text: event.text, responded_at: new Date().toISOString() };

  // Append atomically in the UPDATE itself (Postgres's jsonb `||` reads the
  // current row value as part of the same statement) rather than
  // read-modify-write in JS — two replies landing close together would
  // otherwise both read the same starting array and the second UPDATE would
  // silently clobber the first reply instead of appending to it, permanently
  // stalling that roundtable's completion count.
  const updated = await query(
    `UPDATE roundtable_sessions
     SET agents_responded = agents_responded || $2::jsonb
     WHERE id = $1
     RETURNING agents_responded`,
    [session.id, JSON.stringify([newReply])]
  );
  const responded: RoundtableReply[] = updated.rows[0]?.agents_responded || [];
  logger.info({ sessionId: session.id, hint }, 'Recorded a roundtable reply');

  // Best-effort completion check — see file header on why this is a count
  // comparison, not a verified per-agent match.
  const agentsAsked: string[] = session.agents_asked || [];
  if (responded.length >= agentsAsked.length) {
    await cancelScheduledJob(`roundtable-timeout:${session.id}`);
    await runRoundtableSynthesis(session.id);
  }

  return true;
}

const SYNTHESIS_SYSTEM = `You are Sentinel's synthesis step for a multi-agent roundtable discussion. You will be given a question posed to several AI agents and their individual replies (some agents may not have responded in time). Produce a concise synthesis with three sections: Agreement, Disagreement, and Recommended path. Do not merely restate each reply.`;

async function callSynthesisLLM(question: string, repliesText: string): Promise<string> {
  const prompt = `ROUNDTABLE QUESTION:\n${question}\n\nREPLIES:\n${repliesText}\n\nProduce the synthesis now.`;

  const tryProvider = async (apiKey: string, url: string, model: string): Promise<string> => {
    const res = await axios.post(url,
      { model, messages: [{ role: 'system', content: SYNTHESIS_SYSTEM }, { role: 'user', content: prompt }],
        max_tokens: 500, temperature: 0.2 },
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 30000 }
    );
    return res.data.choices[0]?.message?.content || '';
  };

  // Same multi-provider fallback chain sentinelBrain.ts's callBrainAI uses
  // (reusing the pattern/env vars, not the function itself — that one's
  // prompt/model constants are portfolio-report-specific, this is a
  // differently-shaped prompt).
  const dashscopeBase = process.env['DASHSCOPE_BASE_URL'] || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const chatModel = process.env['CHAT_MODEL'] || 'mistralai/mistral-nemotron';
  const providers = [
    { key: process.env['NVIDIA_API_KEY'],    url: 'https://integrate.api.nvidia.com/v1/chat/completions',                     model: chatModel },
    { key: process.env['GEMINI_API_KEY'],    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-2.5-pro' },
    { key: process.env['DASHSCOPE_API_KEY'], url: `${dashscopeBase}/chat/completions`,                                       model: 'qwen-max' },
    { key: process.env['DEEPSEEK_API_KEY'],  url: 'https://api.deepseek.com/chat/completions',                               model: 'deepseek-chat' },
  ].filter((p): p is { key: string; url: string; model: string } => !!p.key);

  if (providers.length === 0) {
    throw new Error('No AI provider available for roundtable synthesis');
  }

  let lastErr: unknown;
  for (const p of providers) {
    try {
      return await tryProvider(p.key, p.url, p.model);
    } catch (err: any) {
      lastErr = err;
      logger.warn({ err: err.message, url: p.url }, 'Roundtable synthesis provider failed, trying next');
    }
  }
  throw lastErr;
}

/**
 * Shared by both the early-completion path (recordRoundtableReply, once
 * every asked agent appears to have replied) and the timeout-job path
 * (scheduledJobsWorker.ts's ROUNDTABLE_TIMEOUT_JOB branch, once the
 * configured delay elapses regardless of reply count). Idempotent — a
 * session already 'complete' is a no-op, same "already handled, skip"
 * shape as CODERABBIT_FALLBACK_JOB's hasCodeRabbitAuditedCommit check.
 * 
 * Also handles crashed sessions: if a session is 'synthesizing' but its
 * lease (synthesizing_at) is older than 5 minutes, it's considered stale
 * and can be reclaimed by another caller (e.g., the timeout job).
 */
async function runRoundtableSynthesis(sessionId: number): Promise<void> {
  // Atomic claim of the synthesis work — a single conditional UPDATE
  // transitions `status` from 'pending' OR 'synthesizing' (if lease stale)
  // to 'synthesizing' for exactly one caller. The lease timestamp
  // (synthesizing_at) prevents stalling: if a worker crashes after
  // claiming, the lease expires and the timeout job can reclaim.
  const claim = await query(
    `UPDATE roundtable_sessions
       SET status = 'synthesizing', synthesizing_at = NOW()
     WHERE id = $1
       AND (status = 'pending'
            OR (status = 'synthesizing' AND synthesizing_at < NOW() - INTERVAL '5 minutes'))
     RETURNING id, question, agents_asked, agents_responded, repo_name, thread_ts`,
    [sessionId],
  );
  const session = claim.rows[0];
  if (!session) {
    // Either the session id is unknown, OR it existed but wasn't in
    // 'pending' or stale 'synthesizing' state — both are legitimate
    // "nothing to do here" outcomes. Logging at info level since the
    // timeout-job path commonly hits this after the early-completion
    // path won.
    logger.info({ sessionId }, 'runRoundtableSynthesis — session not claimable (already handled, unknown, or lease fresh); skipping');
    return;
  }

  const responded: RoundtableReply[] = session.agents_responded || [];
  const agentsAsked: string[] = session.agents_asked || [];

  const repliesText = responded.length
    ? responded.map(rr => `[${rr.hint}]: ${rr.text}`).join('\n\n')
    : '(no replies were received before the timeout)';
  const missingNote = `\n\nAgents asked: ${agentsAsked.join(', ')}. Replies received: ${responded.length}/${agentsAsked.length}.`;

  let synthesis: string;
  try {
    synthesis = await callSynthesisLLM(session.question, repliesText + missingNote);
  } catch (err: any) {
    logger.error({ err: err.message, sessionId }, 'Roundtable synthesis LLM call failed on every configured provider');
    synthesis = `⚠️ Could not generate a synthesis (all AI providers failed). Raw replies:\n\n${repliesText}${missingNote}`;
  }

  await query(
    `UPDATE roundtable_sessions SET synthesis = $2, status = 'complete', completed_at = NOW() WHERE id = $1`,
    [sessionId, synthesis]
  );

  await sendSlackMessage(`🧭 Roundtable synthesis:\n\n${synthesis}`, session.repo_name, session.thread_ts).catch((err: any) => {
    logger.error({ err: err.message, sessionId }, 'Failed to post roundtable synthesis back to Slack');
  });

  // NOT built: updating the repo's living context document with this
  // outcome (repoContextDoc.ts doesn't exist — see file header). This is
  // where that call would go once it does.

  logger.info({ sessionId }, 'Roundtable synthesis complete');
}

export {
  initRoundtableSchema,
  startRoundtable,
  recordRoundtableReply,
  runRoundtableSynthesis,
};
