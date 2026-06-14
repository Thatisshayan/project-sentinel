const { Client } = require('@notionhq/client');
const logger = require('./logger');

let notion;

function getClient() {
  if (!notion) {
    notion = new Client({ auth: process.env.NOTION_API_KEY });
  }
  return notion;
}

const DATABASE_ID = () => process.env.NOTION_DATABASE_ID;

async function findNotionProject(repoName) {
  const client    = getClient();
  const repoLower = repoName.toLowerCase().replace(/[-_]/g, '');

  // Fetch ALL pages in the database (no filter — so we try all of them)
  let cursor   = undefined;
  let allPages = [];

  do {
    const response = await client.databases.query({
      database_id:  DATABASE_ID(),
      start_cursor: cursor,
      page_size:    100,
    });
    allPages = allPages.concat(response.results);
    cursor   = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  function normalize(s) { return (s || '').toLowerCase().replace(/[-_\s]/g, ''); }

  // Pass 1 — exact match on "Repo Name" rich_text property
  let match = allPages.find(page => {
    const prop = page.properties['Repo Name'];
    if (!prop?.rich_text?.length) return false;
    return normalize(prop.rich_text.map(t => t.plain_text).join('')) === repoLower;
  });

  // Pass 2 — match on page Title / Name / Project properties
  if (!match) {
    match = allPages.find(page => {
      const titleProp = page.properties['Name'] || page.properties['Project'] || page.properties['Title'];
      if (!titleProp?.title?.length) return false;
      return normalize(titleProp.title.map(t => t.plain_text).join('')) === repoLower;
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
    ? titleProp.title.map(t => t.plain_text).join('').trim()
    : repoName;

  return {
    pageId:       match.id,
    projectName,
    url:          match.url,
    builderAgent: match.properties['Builder Agent']?.select?.name || null,
  };
}

async function updateNotionProject(pageId, data) {
  const {
    commitMessage, commitSha, commitUrl,
    branchName, authorName, commitTimestamp,
    changedFilesText, filesChangedCount, riskLevel,
  } = data;

  const now = new Date().toISOString();

  const allProperties = {
    'Last Commit Message': {
      rich_text: [{ text: { content: String(commitMessage).substring(0, 2000) } }],
    },
    'Last Commit Hash': {
      rich_text: [{ text: { content: String(commitSha).substring(0, 100) } }],
    },
    'Last Commit URL': {
      url: commitUrl || null,
    },
    'Last Branch': {
      rich_text: [{ text: { content: String(branchName).substring(0, 100) } }],
    },
    'Last Commit Author': {
      rich_text: [{ text: { content: String(authorName).substring(0, 100) } }],
    },
    'Last Commit Date': {
      date: { start: commitTimestamp },
    },
    'Changed Files': {
      rich_text: [{ text: { content: String(changedFilesText).substring(0, 2000) } }],
    },
    'Files Changed Count': {
      number: filesChangedCount,
    },
    'Last Updated': {
      date: { start: now },
    },
    'Risk Level': {
      select: { name: riskLevel },
    },
  };

  try {
    await getClient().pages.update({
      page_id:    pageId,
      properties: allProperties,
    });
    logger.info({ pageId }, 'Notion bulk update succeeded');
    return;
  } catch (bulkErr) {
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
    } catch (fieldErr) {
      logger.warn({ field: fieldName, err: fieldErr.message },
        'Skipping Notion field — may not exist in database');
    }
  }

  if (successCount === 0) {
    throw new Error('All Notion field updates failed — check API key and database permissions');
  }

  logger.info({ pageId, successCount, total: Object.keys(allProperties).length },
    'Notion field-by-field update complete');
}

async function appendChangelog(pageId, data) {
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
}

async function updateBuilderAgent(pageId, agentId) {
  await getClient().pages.update({
    page_id:    pageId,
    properties: { 'Builder Agent': { select: { name: agentId } } },
  });
}

module.exports = { findNotionProject, updateNotionProject, appendChangelog, updateBuilderAgent };
