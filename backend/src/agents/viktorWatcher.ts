// Phase 6 of docs/2026-07-22-slack-agent-roster-plan.md — Viktor AI
// delegate-CEO authority, the inbound half. Watches Slack messages for ones
// authored by Viktor's bot user and, if they match a recognized authority
// action and pass viktorAuthority.ts's checks, executes it through the same
// orchestrator functions Telegram's own approve flows already call.
//
// CRITICAL, UNVERIFIED (flagged honestly, not guessed past): Viktor's real
// Slack user/bot ID could not be confirmed this session. The Slack MCP tool
// available in this session is connected to a different workspace (it has
// no knowledge of "sentinel" or "coderabbit", both confirmed present in the
// real ObsidianMedia workspace this app runs in) — so there was no way to
// look up Viktor's actual user ID the way CodeRabbit's bot login was
// verified against real GitHub PR comments earlier this session. Rather
// than guess a plausible-looking ID (the mistake already made once with
// CodeRabbit's payload shape in Phase 2), this ships CONFIGURED-OFF:
// VIKTOR_SLACK_USER_ID must be set (find it via Slack's admin panel or
// `users.list` with a real admin token) before anything here executes.
// Unset = every message is ignored, logged at debug only. Do not remove
// this gate without confirming the ID against the real workspace first.
//
// Bounded authority, not blanket: every recognized action goes through
// viktorAuthority.checkAuthority()/canDelegateTo() before executing, and
// every attempt (approved or denied) is logged to agent_authority_log via
// logAuthorityAction() — this is the non-negotiable audit trail the plan
// doc requires. Unrecognized text from Viktor (plain conversation) is not
// logged as an authority event at all — only intent-to-act attempts are.

import logger from '../logger';
import { checkAuthority, canDelegateTo, logAuthorityAction } from '../viktorAuthority';
import { getSettings } from '../settingsDb';
import { sendSlackMessageToChannel } from '../slackClient';
import { dispatchToAgent } from './externalAgentRegistry';

interface SlackMessageEvent {
  user?: string;
  text?: string;
  channel?: string;
}

const APPROVE_SPRINT_RE = /^approve\s+sprint$/i;
const APPROVE_SECURITY_RE = /^approve\s+security\s+(\S+)$/i;
const DELEGATE_RE = /^delegate\s+(\S+)\s+(\S+)\s+(.+)$/i;

async function reply(channel: string | undefined, text: string): Promise<void> {
  if (!channel) return;
  await sendSlackMessageToChannel(text, channel).catch((err: any) =>
    logger.warn({ err: err.message }, 'viktorWatcher reply failed to send')
  );
}

/**
 * Entry point, called from slackEvents.ts's plain `message` handler for
 * every message (not just threaded replies — unlike recordAgentReply,
 * Viktor's authority commands aren't necessarily replies to anything).
 * Safe no-op if VIKTOR_SLACK_USER_ID is unconfigured or doesn't match, or
 * if the message isn't a recognized authority action.
 */
async function handleViktorMessage(event: SlackMessageEvent): Promise<void> {
  const viktorId = process.env['VIKTOR_SLACK_USER_ID'];
  if (!viktorId) {
    logger.debug('VIKTOR_SLACK_USER_ID not configured — viktorWatcher inert');
    return;
  }
  if (!event.user || event.user !== viktorId) return;
  if (typeof event.text !== 'string') return;

  const text = event.text.trim();

  const settings = await getSettings().catch((err: any) => {
    logger.error({ err: err.message }, 'viktorWatcher failed to read settings — denying by default (fail-closed)');
    return { sentinel_paused: true };
  });
  if (settings.sentinel_paused) {
    logger.info({ text }, 'Viktor message received while Sentinel is paused — ignoring (kill switch engaged)');
    await logAuthorityAction({
      actor: 'viktor', action: text, targetRepo: null, targetAgent: null,
      decision: 'denied', reasoning: 'Sentinel is paused (kill switch engaged)',
    });
    await reply(event.channel, '⏸ Sentinel is paused — Viktor-initiated actions are not executed until /sentinel resume.');
    return;
  }

  const approveSprintMatch = APPROVE_SPRINT_RE.exec(text);
  if (approveSprintMatch) {
    await handleApproveSprint(event.channel);
    return;
  }

  const approveSecurityMatch = APPROVE_SECURITY_RE.exec(text);
  if (approveSecurityMatch) {
    await handleApproveSecurity(event.channel, approveSecurityMatch[1] as string);
    return;
  }

  const delegateMatch = DELEGATE_RE.exec(text);
  if (delegateMatch) {
    const [, agentId, repoName, taskDescription] = delegateMatch as unknown as [string, string, string, string];
    await handleDelegate(event.channel, agentId, repoName, taskDescription);
    return;
  }

  // Not a recognized authority action — ordinary conversation from Viktor.
  // Deliberately not logged to agent_authority_log (that table is for
  // actions, not chat) and not dispatched anywhere else; Phase 6's scope is
  // specifically the three action types above.
  logger.debug({ text }, 'Viktor message did not match a known authority action — ignoring');
}

async function handleApproveSprint(channel: string | undefined): Promise<void> {
  const { getCurrentSprint } = require('../sprintDb') as { getCurrentSprint: () => Promise<any> };
  const sprint = await getCurrentSprint().catch((err: any) => {
    logger.error({ err: err.message }, 'viktorWatcher: getCurrentSprint failed');
    return null;
  });

  if (!sprint || sprint.status !== 'proposed') {
    await logAuthorityAction({
      actor: 'viktor', action: 'approve sprint', targetRepo: null, targetAgent: null,
      decision: 'denied', reasoning: sprint ? `Sprint is already ${sprint.status}` : 'No sprint proposal found',
    });
    await reply(channel, sprint
      ? `⚠️ Sprint is already ${sprint.status} — nothing to approve.`
      : '⚠️ No sprint proposal found to approve.');
    return;
  }

  const check = await checkAuthority('sprint_approve', { max_tasks: sprint.total_tasks });
  await logAuthorityAction({
    actor: 'viktor', action: 'approve sprint', targetRepo: null, targetAgent: null,
    decision: check.allowed ? 'executed' : 'denied', reasoning: check.reason,
  });

  if (!check.allowed) {
    await reply(channel, `🚫 Denied: ${check.reason}`);
    return;
  }

  const { approveSprint } = require('../sprintOrchestrator') as { approveSprint: (topicId: number | null) => Promise<void> };
  try {
    await approveSprint(null);
    await reply(channel, '✅ Sprint approved on Viktor\'s authority.');
  } catch (err: any) {
    logger.error({ err: err.message }, 'viktorWatcher: approveSprint execution failed');
    await logAuthorityAction({
      actor: 'viktor', action: 'approve sprint', targetRepo: null, targetAgent: null,
      decision: 'execution_failed', reasoning: err.message,
    });
    await reply(channel, `❌ Approved but execution failed: ${err.message}`);
  }
}

// Severities Viktor may auto-resolve even when the security_patch rule is
// enabled — "approve security patches tagged safe" from the plan doc, made
// concrete against securityDb.ts's real severity field (there is no
// separate "safe" tag in the schema, so this is the closest honest mapping:
// low/medium only, never high/critical). This is a fixed floor, not
// configurable via viktor_authority — a repo with any high/critical issue
// open always requires a human, regardless of the rule's enabled state.
const VIKTOR_AUTO_RESOLVABLE_SEVERITIES = new Set(['low', 'medium']);

async function handleApproveSecurity(channel: string | undefined, repoArg: string): Promise<void> {
  const { repoFullName } = require('../repoResolver') as { repoFullName: (r: string) => string };
  const { getOpenIssues, resolveAllOpenIssues } = require('../securityDb') as {
    getOpenIssues: (repo: string) => Promise<any[]>;
    resolveAllOpenIssues: (repo: string) => Promise<number>;
  };

  const check = await checkAuthority('security_patch', {});
  if (check.allowed) {
    const openIssues = await getOpenIssues(repoFullName(repoArg)).catch((err: any) => {
      logger.error({ err: err.message, repo: repoArg }, 'viktorWatcher: getOpenIssues failed — denying (fail-closed)');
      return null;
    });
    if (openIssues === null) {
      check.allowed = false;
      check.reason = 'Could not verify open issue severities — denying rather than assuming safe';
    } else {
      const blocking = openIssues.find((i: any) => !VIKTOR_AUTO_RESOLVABLE_SEVERITIES.has(String(i.severity).toLowerCase()));
      if (blocking) {
        check.allowed = false;
        check.reason = `${repoArg} has an open '${blocking.severity}' issue — above Viktor's low/medium auto-resolve ceiling`;
      }
    }
  }

  await logAuthorityAction({
    actor: 'viktor', action: 'approve security', targetRepo: repoArg, targetAgent: null,
    decision: check.allowed ? 'executed' : 'denied', reasoning: check.reason,
  });

  if (!check.allowed) {
    await reply(channel, `🚫 Denied: ${check.reason}`);
    return;
  }

  try {
    const count = await resolveAllOpenIssues(repoFullName(repoArg));
    await reply(channel, `✅ Resolved ${count} open security issue(s) for ${repoArg} on Viktor's authority.`);
  } catch (err: any) {
    logger.error({ err: err.message, repo: repoArg }, 'viktorWatcher: resolveAllOpenIssues failed');
    await logAuthorityAction({
      actor: 'viktor', action: 'approve security', targetRepo: repoArg, targetAgent: null,
      decision: 'execution_failed', reasoning: err.message,
    });
    await reply(channel, `❌ Approved but execution failed: ${err.message}`);
  }
}

async function handleDelegate(
  channel: string | undefined,
  agentId: string,
  repoName: string,
  taskDescription: string
): Promise<void> {
  const allowed = await canDelegateTo(agentId);
  await logAuthorityAction({
    actor: 'viktor', action: 'delegate', targetRepo: repoName, targetAgent: agentId,
    decision: allowed ? 'executed' : 'denied',
    reasoning: allowed ? `Delegated: ${taskDescription}` : `'${agentId}' is not in Viktor's can_delegate_to list`,
  });

  if (!allowed) {
    await reply(channel, `🚫 Denied: Viktor is not authorized to delegate to '${agentId}'.`);
    return;
  }

  const result = await dispatchToAgent(agentId, taskDescription, repoName);
  await reply(channel, result
    ? `📤 Delegated to ${agentId} in ${repoName}'s channel on Viktor's authority: "${taskDescription}"`
    : `⚠️ Delegation authorized but dispatch failed — check ${agentId} is enabled and ${repoName} has a mapped Slack channel.`);
}

export { handleViktorMessage };
