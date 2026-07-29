import { safeFire } from '../utils/safeFire';
import { sendTelegramMessage } from '../telegramClient';
import logger from '../logger';
import dbClient from '../dbClient';
import { updateNotionTaskStatus } from '../auditTaskWriter';
import { resolveIssuesByPr } from '../securityDb';
import { resolveDebugAttemptByPr } from '../dbClient';
import projectDb from '../projectDb';

const { query } = dbClient;

export async function processPREvent(payload: any): Promise<void> {
  const { action, pull_request: pr, repository } = payload;
  if (!pr || !repository) return;

  const repoFullName = repository.full_name;
  const branchName   = pr.head?.ref || '';
  const prUrl        = pr.html_url;
  const prNumber     = pr.number;
  const merged       = pr.merged;
  const repoName     = repository.name;

  if (!branchName.startsWith('sentinel/')) return;
  if (action !== 'closed') return;

  logger.info({ repoFullName, prNumber, merged, branch: branchName }, 'Sentinel PR closed');

  // D-027 item 3 (same-PR patch loop) — once a human merges or closes this
  // PR, the accumulating branch is done; clear it so the next batch starts a
  // fresh one instead of continuing to push into a dead branch. Guarded on
  // the currently-recorded branch actually matching this PR's branch, so a
  // stale/duplicate webhook delivery for an already-superseded branch can't
  // clobber a newer active-branch record.
  const activeBranch = await projectDb.getActiveTaskBranch(repoName).catch(() => null);
  if (activeBranch?.branch === branchName) {
    await projectDb.clearActiveTaskBranch(repoName).catch((err: any) =>
      logger.warn({ err: err.message, repoFullName, branchName }, 'Failed to clear active task branch after PR closed')
    );
  }

  if (merged) {
    if (branchName.startsWith('sentinel/security-patch-')) {
      await resolveIssuesByPr(repoFullName, prUrl).catch((err: any) =>
        logger.warn({ err: err.message, repoFullName, prUrl }, 'Failed to resolve security issues after merge')
      );
    }

    if (branchName.startsWith('sentinel/fix-')) {
      const resolved = await resolveDebugAttemptByPr(repoFullName, prUrl).catch((err: any) => {
        logger.warn({ err: err.message, repoFullName, prUrl }, 'Failed to resolve debug attempt after merge');
        return null;
      });
      if (resolved) {
        logger.info({ repoFullName, prUrl }, 'Debug attempt marked resolved after merge');
      }
    }

    const updated = await query(`
      UPDATE audit_tasks
      SET status = 'done', updated_at = NOW()
      WHERE repo_full_name = $1
        AND (pr_url = $2 OR (pr_url IS NULL AND pr_number = $3))
        AND status IN ('build_check', 'in_progress')
      RETURNING id
    `, [repoFullName, prUrl, prNumber]).catch(() => null);

    const taskIds = updated?.rows || [];
    logger.info({ count: taskIds.length, repoFullName }, 'Tasks marked done after PR merge');

    for (const row of taskIds) {
      await safeFire(updateNotionTaskStatus(row.id, 'done', { prUrl }), { label: 'webhook', retryable: true })
    }

    await safeFire(sendTelegramMessage([
      `Project Sentinel — PR Merged ✅`,
      ``,
      `Repo: ${repoName}`,
      `PR #${prNumber} merged`,
      `Branch: ${branchName}`,
      taskIds.length > 0 ? `${taskIds.length} task(s) marked complete` : '',
      ``,
      `Next batch will run on next commit or /sentinel run-sprint ${repoName}`,
    ].filter(Boolean).join('\n'), repoName, null), { label: 'webhook' })

  } else {
    const updated = await query(`
      UPDATE audit_tasks
      SET status = 'queued', branch_name = NULL, commit_sha = NULL,
          pr_url = NULL, pr_number = NULL, updated_at = NOW()
      WHERE repo_full_name = $1
        AND (pr_url = $2 OR (pr_url IS NULL AND pr_number = $3))
        AND status IN ('build_check', 'in_progress')
      RETURNING id
    `, [repoFullName, prUrl, prNumber]).catch(() => null);

    const count = updated?.rows?.length || 0;
    logger.info({ count, repoFullName }, 'Tasks requeued after PR rejection');

    await safeFire(sendTelegramMessage([
      `Project Sentinel — PR Rejected ⚠️`,
      ``,
      `Repo: ${repoName}`,
      `PR #${prNumber} closed without merging`,
      `Branch: ${branchName}`,
      count > 0 ? `${count} task(s) requeued — /sentinel run-sprint ${repoName} to retry` : '',
    ].filter(Boolean).join('\n'), repoName, null), { label: 'webhook' })
  }
}
