// Phase 1 of docs/2026-07-22-slack-agent-roster-plan.md — Block Kit button
// clicks (Slack's "interactivity" payloads). Separate from slackEvents.ts
// because Slack delivers these as application/x-www-form-urlencoded with a
// `payload` field containing JSON, not the plain JSON body the Events API
// uses — different content type, different parsing, same v0 signature
// scheme underneath (reused from slackEvents.ts).
//
// Scope: only the audit execute/skip buttons (the primary approve/skip
// flow, mirroring telegramCommands.ts's handleCallbackQuery for
// 'execute:'/'skip:') — not a port of every Telegram inline-keyboard menu.
// Routes to the exact same executeApprovedTasks/stopAllTasksForRepo
// functions Telegram's callback handler already calls, so behavior is
// identical regardless of which platform the click came from.

import logger from './logger';
import { verifySlackSignature } from './slackEvents';
import { repoFullName } from './repoResolver';
import { sendSlackMessage } from './slackClient';

async function handleSlackInteraction(req: any, res: any): Promise<void> {
  if (!verifySlackSignature(req)) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  // Ack immediately — same 3-second requirement as Events API.
  res.status(200).send('');

  let payload: any;
  try {
    payload = JSON.parse(req.body?.payload || '{}');
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Slack interaction payload was not valid JSON');
    return;
  }

  const action = payload.actions?.[0];
  if (!action) return;

  const actionId = action.action_id;
  const repoName = action.value;
  if (!repoName) {
    logger.warn({ actionId }, 'Slack interaction had no repo value — ignoring');
    return;
  }

  if (actionId === 'execute') {
    const { executeApprovedTasks } = require('./auditOrchestrator') as { executeApprovedTasks: (...args: any[]) => Promise<void> };
    await sendSlackMessage(`Starting execution for ${repoName}...`, repoName, null);
    executeApprovedTasks(repoFullName(repoName), repoName, null).catch((err: any) =>
      logger.error({ err: err.stack ?? err.message, repoName }, 'Slack-triggered execute failed')
    );
    return;
  }

  if (actionId === 'skip') {
    const { stopAllTasksForRepo } = require('./auditDb') as { stopAllTasksForRepo: (repoFullName: string) => Promise<void> };
    await stopAllTasksForRepo(repoFullName(repoName));
    await sendSlackMessage(`Audit skipped for ${repoName}.`, repoName, null);
    return;
  }

  logger.info({ actionId, repoName }, 'Unrecognized Slack interaction action_id — ignored');
}

export { handleSlackInteraction };
