// Phase 2 (revised, 2026-07-22) of docs/2026-07-22-slack-agent-roster-plan.md
// — CodeRabbit has NO self-serve outbound webhook for GitHub-based repos
// (confirmed by the owner checking their dashboard, and by CodeRabbit's own
// docs: for GitHub, CodeRabbit's webhook flows GitHub -> CodeRabbit, not the
// reverse). The original processCodeRabbitEvent.ts's /webhook/coderabbit
// receiver was built against a webhook that doesn't exist for this setup —
// left in place as dormant infrastructure (useful if CodeRabbit adds this,
// or for a GitLab/self-hosted setup later) but this file is the actual
// ingestion path for GitHub: CodeRabbit posts its findings as PR review
// comments, which arrive through the *existing* GitHub webhook
// (webhook.ts's /github route) as pull_request_review_comment events —
// this just needs to recognize CodeRabbit's bot account among the authors.
//
// IMPORTANT — CodeRabbit's GitHub App bot login is assumed to be
// 'coderabbitai[bot]' (its publicly known account name) but has NOT been
// verified against a real delivery from this account. Re-check
// CODERABBIT_BOT_LOGIN against an actual webhook payload before relying on
// this — if wrong, isFromCodeRabbit() silently returns false for every
// real comment and nothing gets ingested (fails closed, not open, but
// still silently).

import logger from '../logger';
import { safeFire } from '../utils/safeFire';
import { sendTelegramMessage } from '../telegramClient';
import { createAuditCycle, getAuditCycle, createAuditTask, getQueuedTaskCount } from '../auditDb';

const CODERABBIT_BOT_LOGIN = 'coderabbitai[bot]';

function isFromCodeRabbit(login: string | undefined | null): boolean {
  return (login || '').toLowerCase() === CODERABBIT_BOT_LOGIN;
}

/** Crude severity inference from comment text — CodeRabbit doesn't expose a structured severity field on PR comments the way a dedicated API would. Refine once real comment text is seen. */
function severityFromBody(body: string): 'critical' | 'high' | 'medium' | 'low' {
  const lower = body.toLowerCase();
  if (lower.includes('critical')) return 'critical';
  if (lower.includes('security') || lower.includes('vulnerability')) return 'high';
  if (lower.includes('minor') || lower.includes('nit:') || lower.includes('nitpick')) return 'low';
  return 'medium';
}

/**
 * Handles a GitHub pull_request_review_comment webhook event — ingests it
 * as one audit_tasks row if (and only if) it was authored by CodeRabbit's
 * bot account. Every other comment (human reviewers, other bots) is
 * silently ignored — this handler is additive to whatever else
 * webhook.ts's /github route already does with the same event, not a
 * replacement.
 */
async function processCodeRabbitPRComment(payload: any): Promise<void> {
  const comment = payload?.comment;
  const pr = payload?.pull_request;
  const repository = payload?.repository;
  if (!comment || !pr || !repository) return;
  if (!isFromCodeRabbit(comment.user?.login)) return;

  const repoFullName = repository.full_name;
  const repoName = repoFullName.split('/')[1] || repoFullName;
  const commitSha = pr.head?.sha || 'unknown';

  let cycle = await getAuditCycle(repoFullName, commitSha).catch(() => null);
  if (!cycle) {
    cycle = await createAuditCycle({ repoFullName, commitSha }).catch(() => null);
  }
  if (!cycle) {
    logger.warn({ repoFullName, commitSha }, 'processCodeRabbitPRComment: could not resolve or create an audit cycle');
    return;
  }

  const existingCount = await getQueuedTaskCount(repoFullName).catch(() => 0);
  await createAuditTask({
    auditCycleId: cycle.id,
    repoFullName,
    taskNumber: existingCount + 1,
    title: (comment.body || '').slice(0, 80) || 'CodeRabbit finding',
    description: comment.body || '',
    priority: severityFromBody(comment.body || ''),
    category: 'code-quality',
    affectedFiles: comment.path ? [comment.path] : [],
    source: 'coderabbit',
    // Conservative default, same as the dormant webhook path — a PR
    // comment needs human review before Sentinel's builders act on it.
    safeToAutoExecute: false,
  }).catch((err: any) => {
    logger.error({ err: err.message, repoFullName, cycleId: cycle.id }, 'Failed to record CodeRabbit finding as an audit task');
  });

  await safeFire(sendTelegramMessage(
    `🐰 CodeRabbit finding — ${repoName} PR #${pr.number}${comment.path ? ` (${comment.path})` : ''}\n${(comment.body || '').slice(0, 200)}\n${comment.html_url || pr.html_url || ''}`,
    repoName, null
  ), { label: 'processCodeRabbitPRComment' });

  logger.info({ repoFullName, cycleId: cycle.id, path: comment.path }, 'CodeRabbit PR comment ingested');
}

export { processCodeRabbitPRComment, isFromCodeRabbit, CODERABBIT_BOT_LOGIN };
