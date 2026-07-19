import { Client } from '@notionhq/client';
import logger from './logger';

let notion: any;

function getClient(): any {
  if (!notion) {
    notion = new Client({ auth: process.env['NOTION_API_KEY'] });
  }
  return notion;
}

const DATABASE_ID = (): string | undefined => process.env['NOTION_DATABASE_ID'];

const PAGE_CACHE_TTL_MS = 60 * 60 * 1000;
const notionPageCache: { pages: any[] | null; cachedAt: number } = { pages: null, cachedAt: 0 };

async function getPageList(): Promise<any[]> {
  const now = Date.now();
  if (notionPageCache.pages && (now - notionPageCache.cachedAt) < PAGE_CACHE_TTL_MS) {
    return notionPageCache.pages;
  }

  const client = getClient();
  let cursor: string | undefined   = undefined;
  let allPages: any[] = [];

  do {
    const response: any = await client.databases.query({
      database_id:  DATABASE_ID(),
      start_cursor: cursor,
      page_size:    100,
    });
    allPages = allPages.concat(response.results);
    cursor   = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  notionPageCache.pages    = allPages;
  notionPageCache.cachedAt = now;
  logger.info({ count: allPages.length }, 'Notion page list cached');
  return allPages;
}

async function findNotionProject(repoName: string): Promise<any> {
  const repoLower = repoName.toLowerCase().replace(/[-_]/g, '');
  const allPages  = await getPageList();

  function normalize(s: string): string { return (s || '').toLowerCase().replace(/[-_\s]/g, ''); }

  let match = allPages.find((page: any) => {
    const prop = page.properties['Repo Name'];
    if (!prop?.rich_text?.length) return false;
    return normalize(prop.rich_text.map((t: any) => t.plain_text).join('')) === repoLower;
  });

  if (!match) {
    match = allPages.find((page: any) => {
      const titleProp = page.properties['Name'] || page.properties['Project'] || page.properties['Title'];
      if (!titleProp?.title?.length) return false;
      return normalize(titleProp.title.map((t: any) => t.plain_text).join('')) === repoLower;
    });
    if (match) {
      logger.info({ repoName }, 'Notion project matched via title fallback — consider adding Repo Name property');
    }
  }

  if (!match) {
    logger.warn({ repoName }, 'Notion project not found — check Repo Name property is filled in for this page');
    return null;
  }

  const titleProp   = match.properties['Name'] || match.properties['Project'] || match.properties['Title'];
  const projectName = titleProp?.title?.length
    ? titleProp.title.map((t: any) => t.plain_text).join('').trim()
    : repoName;

  const topicIdProp = match.properties['Topic ID'];
  const topicId = topicIdProp?.rich_text?.length
    ? topicIdProp.rich_text.map((t: any) => t.plain_text).join('').trim()
    : null;

  return {
    pageId:       match.id,
    projectName,
    url:          match.url,
    builderAgent: match.properties['Builder Agent']?.select?.name || null,
    topicId,
  };
}

async function updateNotionProject(pageId: string, data: any): Promise<void> {
  const {
    commitMessage, commitSha, commitUrl,
    branchName, authorName, commitTimestamp,
    changedFilesText, filesChangedCount, riskLevel,
    deploymentStatus, buildProvider, buildUrl,
    currentProjectState, lastBuildError,
    highRiskFlag, highRiskReason,
  } = data;

  const now = new Date().toISOString();

  const allProperties: Record<string, any> = {};
  if (commitMessage !== undefined)
    allProperties['Last Commit Message'] = { rich_text: [{ text: { content: String(commitMessage).substring(0, 2000) } }] };
  if (commitSha !== undefined)
    allProperties['Last Commit Hash']    = { rich_text: [{ text: { content: String(commitSha).substring(0, 100) } }] };
  if (commitUrl !== undefined)
    allProperties['Last Commit URL']     = { url: commitUrl || null };
  if (branchName !== undefined)
    allProperties['Last Branch']         = { rich_text: [{ text: { content: String(branchName).substring(0, 100) } }] };
  if (authorName !== undefined)
    allProperties['Last Commit Author']  = { rich_text: [{ text: { content: String(authorName).substring(0, 100) } }] };
  if (commitTimestamp !== undefined)
    allProperties['Last Commit Date']    = { date: { start: commitTimestamp } };
  if (changedFilesText !== undefined)
    allProperties['Changed Files']       = { rich_text: [{ text: { content: String(changedFilesText).substring(0, 2000) } }] };
  if (filesChangedCount !== undefined)
    allProperties['Files Changed Count'] = { number: filesChangedCount };
  if (riskLevel !== undefined)
    allProperties['Risk Level']          = { select: { name: riskLevel } };
  allProperties['Last Updated']          = { date: { start: now } };

  if (deploymentStatus !== undefined) {
    allProperties['Deployment Status'] = { select: { name: deploymentStatus } };
  }
  if (buildProvider !== undefined) {
    allProperties['Build Provider'] = { select: { name: String(buildProvider || '').substring(0, 100) } };
  }
  if (buildUrl !== undefined) {
    allProperties['Build URL'] = { url: buildUrl || null };
  }
  if (currentProjectState !== undefined) {
    allProperties['Current Project State'] = { select: { name: currentProjectState } };
  }
  if (lastBuildError !== undefined) {
    allProperties['Last Build Error'] = { rich_text: [{ text: { content: String(lastBuildError || '').substring(0, 2000) } }] };
  }
  if (highRiskFlag !== undefined) {
    allProperties['High Risk'] = { select: { name: highRiskFlag } };
  }
  if (highRiskReason !== undefined) {
    allProperties['High Risk Reason'] = { rich_text: [{ text: { content: String(highRiskReason || '').substring(0, 2000) } }] };
  }

  try {
    await getClient().pages.update({
      page_id:    pageId,
      properties: allProperties,
    });
    logger.info({ pageId }, 'Notion bulk update succeeded');
    bustNotionCache();
    return;
  } catch (bulkErr: any) {
    logger.warn({ err: bulkErr.message },
      'Bulk Notion update failed — falling back to field-by-field');
  }

  let successCount = 0;
  for (const [fieldName, value] of Object.entries(allProperties)) {
    try {
      await getClient().pages.update({
        page_id:    pageId,
        properties: { [fieldName]: value },
      });
      successCount++;
    } catch (fieldErr: any) {
      logger.warn({ field: fieldName, err: fieldErr.message },
        'Skipping Notion field — may not exist in database');
    }
  }

  if (successCount === 0) {
    throw new Error('All Notion field updates failed — check API key and database permissions');
  }

  logger.info({ pageId, successCount, total: Object.keys(allProperties).length },
    'Notion field-by-field update complete');
  bustNotionCache();
}

async function appendChangelog(pageId: string, data: any): Promise<void> {
  const {
    commitTimestamp, projectName, repoName,
    branchName, commitSha, authorName,
    commitMessage, filesChangedCount,
    isMarketingOnlyUpdate, commitUrl, riskLevel,
  } = data;

  const dateStr = new Date(commitTimestamp).toUTCString();
  const shortSha = commitSha.substring(0, 7);

  const entryText =
`Sentinel Update — ${dateStr}

Project: ${projectName || repoName}
Repo: ${repoName}
Branch: ${branchName}
Commit: ${shortSha}
Author: ${authorName}
Message: ${commitMessage}
Files Changed: ${filesChangedCount}
Risk: ${riskLevel}
Marketing Update: ${isMarketingOnlyUpdate ? 'Yes' : 'No'}
Commit URL: ${commitUrl}`;

  await getClient().blocks.children.append({
    block_id: pageId,
    children: [
      {
        object: 'block',
        type:   'callout',
        callout: {
          rich_text: [
            {
              type: 'text',
              text: { content: entryText.substring(0, 2000) },
            },
          ],
          icon:  { emoji: '📝' },
          color: 'gray_background',
        },
      },
    ],
  });
  bustNotionCache();
}

async function updateBuilderAgent(pageId: string, agentId: string): Promise<void> {
  await getClient().pages.update({
    page_id:    pageId,
    properties: { 'Builder Agent': { select: { name: agentId } } },
  });
}

/**
 * Creates a new project page in the Notion database for a newly-onboarded
 * repo. repoOnboarder.ts feature-detects this function before calling it —
 * previously it didn't exist at all, so every auto-onboarded repo silently
 * got no Notion page while the operator was told "Notion row created ✅".
 * Retries with only the identifying fields if the full property set fails
 * (e.g. a 'Priority'/'Builder Agent' select option or property doesn't
 * exist in this database) so the repo is still findable via
 * findNotionProject() even when the richer fields can't be set.
 */
async function createNotionProject(data: { repoName: string; priority?: string; builderAgent?: string }): Promise<string | null> {
  const { repoName, priority, builderAgent } = data;
  const databaseId = DATABASE_ID();
  if (!databaseId) {
    logger.warn({ repoName }, 'NOTION_DATABASE_ID not set — cannot create Notion project');
    return null;
  }

  const minimalProperties: Record<string, any> = {
    'Name':      { title: [{ text: { content: repoName } }] },
    'Repo Name': { rich_text: [{ text: { content: repoName } }] },
  };
  const fullProperties: Record<string, any> = { ...minimalProperties };
  if (priority)     fullProperties['Priority']      = { select: { name: priority } };
  if (builderAgent) fullProperties['Builder Agent'] = { select: { name: builderAgent } };

  try {
    const page: any = await getClient().pages.create({
      parent:     { database_id: databaseId },
      properties: fullProperties,
    });
    bustNotionCache();
    logger.info({ repoName, pageId: page.id }, 'Notion project page created');
    return page.id;
  } catch (err: any) {
    // Only retry with a reduced property set when the failure is a schema
    // mismatch (e.g. 'Priority'/'Builder Agent' doesn't exist as a select
    // option or property in this database) — that's the one case a smaller
    // payload can actually fix. For anything else (rate limit, auth,
    // timeout, transient 5xx), retrying with fewer fields would silently
    // create a degraded page instead of surfacing the real failure.
    if (err.code !== 'validation_error') {
      logger.error({ err: err.message, code: err.code, repoName },
        'Notion project page creation failed (non-schema error) — not retrying with reduced fields');
      return null;
    }
    logger.warn({ err: err.message, repoName }, 'Full-property Notion page create failed schema validation — retrying with minimal fields');
  }

  try {
    const page: any = await getClient().pages.create({
      parent:     { database_id: databaseId },
      properties: minimalProperties,
    });
    bustNotionCache();
    logger.info({ repoName, pageId: page.id }, 'Notion project page created (minimal fields)');
    return page.id;
  } catch (err: any) {
    logger.error({ err: err.message, repoName }, 'Notion project page creation failed entirely — add repo row manually');
    return null;
  }
}

function bustNotionCache(): void {
  notionPageCache.pages    = null;
  notionPageCache.cachedAt = 0;
}

export = {
  findNotionProject, updateNotionProject, appendChangelog,
  updateBuilderAgent, createNotionProject, bustNotionCache,
};
