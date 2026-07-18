import { safeFire, fireAndForget } from '../utils/safeFire';
import logger from '../logger';
import { extractPayload } from '../extractPayload';
import { findNotionProject, updateNotionProject, appendChangelog } from '../notionClient';
import { sendTelegramMessage } from '../telegramClient';
import { isAlreadyProcessed, markAsProcessed } from '../deduplication';
import { enqueueBuildCheck } from '../queueClient';
import dbClient from '../dbClient';
import { upsertRepoMetrics } from '../portfolioDb';
import { refreshRepoMetrics } from '../portfolioAnalytics';
import { buildSuccessMessage, buildUnknownRepoMessage, buildErrorMessage } from './messages';
import { Client } from '@notionhq/client';
import { runSecurityScan } from '../securityScanner';
import { notifyDependents } from '../crossRepoCoordinator';

const { query } = dbClient;

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

  const seen = await isAlreadyProcessed(repoName, commitSha);
  if (seen) {
    logger.info({ repoName, commitSha: commitSha.substring(0, 7) }, 'Duplicate — skipping');
    return;
  }
  await markAsProcessed(repoName, commitSha);

  let notionProject: any;
  try {
    notionProject = await findNotionProject(repoNameLower);
  } catch (err: any) {
    logger.error({ err: err.stack ?? err.message, repoName }, 'Notion search threw an error');
    await safeFire(sendTelegramMessage(
      buildErrorMessage('Notion search failed', repoName, err.message),
      repoName
    ), { label: 'webhook' })
    return;
  }

  if (!notionProject) {
    logger.warn({ repoName }, 'No matching Notion project');
    let suggestionNote = '';
    try {
      const nc = new Client({ auth: process.env['NOTION_API_KEY'] });
      const resp = await nc.databases.query({
        database_id: process.env['NOTION_DATABASE_ID'] as string,
        page_size: 20,
      }).catch(() => null);
      if (resp?.results?.length) {
        const names = resp.results.map((p: any) => {
          const t = p.properties['Name'] || p.properties['Project'] || p.properties['Title'];
          return t?.title?.[0]?.plain_text || '(untitled)';
        }).filter(Boolean);
        suggestionNote = `\n\nExisting Notion pages: ${names.join(', ')}\nAdd a "Repo Name" property with value "${repoName}" to the matching page.`;
      }
    } catch {}
    await safeFire(sendTelegramMessage(buildUnknownRepoMessage(data) + suggestionNote, repoName), { label: 'webhook' })
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
    } catch {}
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
  } catch {}
}
