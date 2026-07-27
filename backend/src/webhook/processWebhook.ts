import { safeFire, fireAndForget } from '../utils/safeFire';
import logger from '../logger';
import { extractPayload } from '../extractPayload';
import { findNotionProject, updateNotionProject, appendChangelog } from '../notionClient';
import { sendTelegramMessage } from '../telegramClient';
import { claimProcessing, unmarkProcessed } from '../deduplication';
import { enqueueBuildCheck } from '../queueClient';
import dbClient from '../dbClient';
import { upsertRepoMetrics } from '../portfolioDb';
import { refreshRepoMetrics } from '../portfolioAnalytics';
import { buildSuccessMessage, buildUnknownRepoMessage, buildErrorMessage } from './messages';
import { runSecurityScan } from '../securityScanner';
import { notifyDependents } from '../crossRepoCoordinator';

const { query } = dbClient;

// Notion API error codes that a redelivery retry cannot fix — a bad
// integration token, a database the integration isn't shared with, or a
// restricted resource will fail identically every time. Everything else
// (rate limits, 5xx, network errors with no .code at all) is treated as
// retryable, since retrying is the whole point of releasing the claim.
const PERMANENT_NOTION_ERROR_CODES = new Set(['unauthorized', 'restricted_resource', 'object_not_found']);

function isPermanentNotionError(err: any): boolean {
  return PERMANENT_NOTION_ERROR_CODES.has(err?.code);
}

export async function processWebhook(payload: any): Promise<void> {
  let data: any;
  try {
    data = extractPayload(payload);
  } catch (err: any) {
    logger.error({ err: err.stack ?? err.message }, 'Payload extraction failed — cannot process');
    return;
  }

  const { repoName, repoNameLower, commitSha, branchName } = data;

  logger.info(
    { repoName, commitSha: commitSha.substring(0, 7), branch: branchName },
    'Processing webhook'
  );

  // Atomic claim: returns true if we won the right to process this event,
  // false if another process already claimed it (duplicate).
  const claimed = await claimProcessing(repoName, commitSha);
  if (!claimed) {
    logger.info({ repoName, commitSha: commitSha.substring(0, 7) }, 'Duplicate — skipping');
    return;
  }

  let notionProject: any;
  try {
    notionProject = await findNotionProject(repoNameLower);
  } catch (err: any) {
    logger.error({ err: err.stack ?? err.message, repoName }, 'Notion search threw an error');
    if (!isPermanentNotionError(err)) {
      await unmarkProcessed(repoName, commitSha);
    }
    await safeFire(sendTelegramMessage(
      buildErrorMessage('Notion search failed', repoName, err.message),
      repoName
    ), { label: 'webhook' })
    return;
  }

  if (!notionProject) {
    logger.warn({ repoName }, 'No matching Notion project');
    await safeFire(sendTelegramMessage(buildUnknownRepoMessage(data), repoName), { label: 'webhook' })
    return;
  }

  data.projectName  = notionProject.projectName;
  data.notionPageId = notionProject.pageId;

  logger.info(
    { repoName, projectName: notionProject.projectName },
    'Matched Notion project'
  );

  try {
    await updateNotionProject(notionProject.pageId, data);
  } catch (err: any) {
    logger.error({ err: err.stack ?? err.message, repoName }, 'Notion update failed');
    if (!isPermanentNotionError(err)) {
      await unmarkProcessed(repoName, commitSha);
    }
    await safeFire(sendTelegramMessage(
      buildErrorMessage('Notion update failed', repoName, err.message),
      repoName
    ), { label: 'webhook' })
    return;
  }

  let changelogAppended = false;
  try {
    await appendChangelog(notionProject.pageId, data);
    changelogAppended = true;
  } catch (err: any) {
    logger.warn({ err: err.message, repoName }, 'Changelog append failed — continuing');
  }

  try {
    await sendTelegramMessage(buildSuccessMessage(data, changelogAppended), repoName);
  } catch (err: any) {
    logger.error({ err: err.stack ?? err.message, repoName }, 'Telegram send failed');
  }

  await Promise.allSettled([
    upsertRepoMetrics({
      repoFullName: data.repoFullName,
      repoName:     data.repoName,
      lastCommitAt: data.commitTimestamp ? new Date(data.commitTimestamp) : new Date(),
      buildStatus:  'unknown',
      priority:     'medium',
    }).catch((err: any) => logger.warn({ err: err.message }, 'Metrics upsert failed')),
    refreshRepoMetrics(data.repoFullName, data.repoName)
      .catch((err: any) => logger.warn({ err: err.message }, 'Post-push metrics refresh failed')),
  ]);

  if (notionProject && data.riskLevel === 'High') {
    try {
      runSecurityScan({
        repoFullName:  data.repoFullName,
        repoName:      data.repoName,
        commitSha:     data.commitSha,
        branchName:    data.branchName,
        topicId:       notionProject.topicId || null,
      }).catch((err: any) => logger.warn({ err: err.message }, 'High-risk security scan failed — non-blocking'));
      logger.info({ repoName: data.repoName, risk: 'High' }, 'Security scan triggered for high-risk push');
    } catch (err: any) {
      logger.warn({ err: err.message, repoName: data.repoName }, 'Failed to trigger high-risk security scan');
    }
  }

  if (notionProject) {
    try {
      await enqueueBuildCheck({
        projectName:   notionProject.projectName,
        repoName:      data.repoName,
        repoFullName:  data.repoFullName,
        branchName:    data.branchName,
        commitSha:     data.commitSha,
        commitUrl:     data.commitUrl,
        commitMessage: data.commitMessage,
        authorName:    data.authorName,
        changedFiles:  data.changedFiles,
        topicId:       notionProject.topicId || null,
      });
      logger.info({ repoName: data.repoName }, 'Build check job queued');
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Failed to queue build check — non-blocking');
    }
  }

  logger.info(
    { repoName, projectName: notionProject.projectName, changelogAppended },
    'Webhook processing complete'
  );

  try {
    fireAndForget(notifyDependents(repoName, data.commitSha, data.authorName), { label: 'webhook' })
  } catch (err: any) {
    logger.warn({ err: err.message, repoName }, 'Failed to fire notifyDependents');
  }
}
