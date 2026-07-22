// Phase 1 of docs/2026-07-22-slack-agent-roster-plan.md — inbound Slack
// (Events API, HTTP mode per the owner's confirmed choice — not Socket
// Mode). Unlike CodeRabbit's webhook (whose payload/signature shape was an
// unverified guess), Slack's Events API request-signing scheme is public,
// stable documentation (v0 HMAC-SHA256 over "v0:{timestamp}:{rawBody}",
// header X-Slack-Signature, replay-protected via X-Slack-Request-Timestamp)
// — the verification below is not a guess and should not need correction
// once a real signing secret exists.
//
// Scope of this file: receive app_mention events, strip the leading bot
// mention, and route the remaining text through the same
// commandRegistry.dispatchCommand() Phase 0 already built — so Slack and
// Telegram share identical command-handling logic, only the inbound
// transport differs. Also handles plain `message` events for Phase 4's
// reply correlation (externalAgentRegistry.ts's recordAgentReply) — this
// requires the Slack app's Events API subscription to include
// `message.channels` in addition to `app_mention`, and (per the plan doc's
// still-open item) needs verifying that bot-authored messages from other
// apps (Kilo, Manus, etc.) actually reach this endpoint and aren't
// filtered by Slack by default.
//
// Known limitation, not fixed here: several existing command-handler reply
// call sites pass `repoName: null` to sendTelegramMessage (relying on
// Telegram's topicId for routing instead), which means slackClient.ts's
// fan-out silently no-ops for those specific replies even once Slack is
// fully configured, since it looks up the destination channel by repoName.
// Full Slack reply parity requires auditing those call sites — flagged in
// the plan doc as a follow-up, not attempted in this slice.

import crypto from 'crypto';
import logger from './logger';
import { dispatchCommand } from './commandRegistry';
import { recordAgentReply } from './agents/externalAgentRegistry';
import { recordRoundtableReply } from './agents/roundtable';

const MAX_TIMESTAMP_SKEW_SECONDS = 60 * 5; // Slack's own documented replay-attack window

function verifySlackSignature(req: any): boolean {
  const signingSecret = process.env['SLACK_SIGNING_SECRET'];
  if (!signingSecret) {
    logger.error('SLACK_SIGNING_SECRET not set — rejecting Slack event');
    return false;
  }

  const timestamp = req.headers['x-slack-request-timestamp'];
  const signature  = req.headers['x-slack-signature'];
  if (!timestamp || !signature) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_TIMESTAMP_SKEW_SECONDS) {
    logger.warn({ age }, 'Slack event timestamp outside allowed skew — possible replay, rejecting');
    return false;
  }

  const rawBody = req.rawBody ? req.rawBody.toString() : JSON.stringify(req.body);
  const baseString = `v0:${timestamp}:${rawBody}`;
  const expected = 'v0=' + crypto.createHmac('sha256', signingSecret).update(baseString).digest('hex');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
}

/** Strips a leading "<@BOTID>" (and optional following punctuation/space) from an app_mention's text. */
function stripBotMention(text: string): string {
  return text.replace(/^\s*<@[A-Z0-9]+>[:,]?\s*/i, '').trim();
}

async function handleSlackEvent(req: any, res: any): Promise<void> {
  const body = req.body || {};

  // Slack's one-time URL-verification handshake when the Events API
  // subscription is first configured — must be answered before any
  // signature/event handling for this to ever start receiving real events.
  if (body.type === 'url_verification') {
    res.status(200).json({ challenge: body.challenge });
    return;
  }

  if (!verifySlackSignature(req)) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  // Ack immediately — Slack requires a response within 3 seconds and
  // retries aggressively otherwise; actual command handling runs after.
  res.status(200).json({ ok: true });

  const event = body.event;
  if (!event) return;

  if (event.type === 'app_mention' && typeof event.text === 'string') {
    const commandText = stripBotMention(event.text);
    if (!commandText) return;

    const dispatched = await dispatchCommand(commandText, null, null).catch((err: any) => {
      logger.error({ err: err.message, commandText }, 'Slack app_mention dispatch failed');
      return false;
    });

    if (!dispatched) {
      logger.info({ commandText, channel: event.channel }, 'Slack mention did not match any known command');
    }
    return;
  }

  // Phase 4 reply correlation — a threaded reply in a channel where a task
  // was previously dispatched to an external agent. Most `message` events
  // aren't this (ordinary conversation, edits, etc.) — recordAgentReply()
  // is a safe no-op (returns false) when thread_ts doesn't match any
  // pending dispatch, so this doesn't need to pre-filter which messages
  // might be relevant.
  if (event.type === 'message' && event.thread_ts && typeof event.text === 'string' && event.channel) {
    await recordAgentReply(event.channel, event.thread_ts, event.text).catch((err: any) => {
      logger.error({ err: err.message, channel: event.channel }, 'recordAgentReply failed');
    });
    // Phase 7 — a channel can have both a pending single-agent dispatch
    // (Phase 4) and a pending roundtable session at once; both checks are
    // safe no-ops when their respective thread_ts doesn't match.
    await recordRoundtableReply(event.channel, event.thread_ts, event).catch((err: any) => {
      logger.error({ err: err.message, channel: event.channel }, 'recordRoundtableReply failed');
    });
  }
}

export { handleSlackEvent, verifySlackSignature, stripBotMention };
