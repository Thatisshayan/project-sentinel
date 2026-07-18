"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const client_1 = require("@notionhq/client");
const logger_1 = __importDefault(require("./logger"));
let notion;
function getClient() {
    if (!notion) {
        notion = new client_1.Client({ auth: process.env['NOTION_API_KEY'] });
    }
    return notion;
}
const DATABASE_ID = () => process.env['NOTION_DATABASE_ID'];
const PAGE_CACHE_TTL_MS = 60 * 60 * 1000;
const notionPageCache = { pages: null, cachedAt: 0 };
async function getPageList() {
    const now = Date.now();
    if (notionPageCache.pages && (now - notionPageCache.cachedAt) < PAGE_CACHE_TTL_MS) {
        return notionPageCache.pages;
    }
    const client = getClient();
    let cursor = undefined;
    let allPages = [];
    do {
        const response = await client.databases.query({
            database_id: DATABASE_ID(),
            start_cursor: cursor,
            page_size: 100,
        });
        allPages = allPages.concat(response.results);
        cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);
    notionPageCache.pages = allPages;
    notionPageCache.cachedAt = now;
    logger_1.default.info({ count: allPages.length }, 'Notion page list cached');
    return allPages;
}
async function findNotionProject(repoName) {
    const repoLower = repoName.toLowerCase().replace(/[-_]/g, '');
    const allPages = await getPageList();
    function normalize(s) { return (s || '').toLowerCase().replace(/[-_\s]/g, ''); }
    let match = allPages.find((page) => {
        const prop = page.properties['Repo Name'];
        if (!prop?.rich_text?.length)
            return false;
        return normalize(prop.rich_text.map((t) => t.plain_text).join('')) === repoLower;
    });
    if (!match) {
        match = allPages.find((page) => {
            const titleProp = page.properties['Name'] || page.properties['Project'] || page.properties['Title'];
            if (!titleProp?.title?.length)
                return false;
            return normalize(titleProp.title.map((t) => t.plain_text).join('')) === repoLower;
        });
        if (match) {
            logger_1.default.info({ repoName }, 'Notion project matched via title fallback — consider adding Repo Name property');
        }
    }
    if (!match) {
        logger_1.default.warn({ repoName }, 'Notion project not found — check Repo Name property is filled in for this page');
        return null;
    }
    const titleProp = match.properties['Name'] || match.properties['Project'] || match.properties['Title'];
    const projectName = titleProp?.title?.length
        ? titleProp.title.map((t) => t.plain_text).join('').trim()
        : repoName;
    const topicIdProp = match.properties['Topic ID'];
    const topicId = topicIdProp?.rich_text?.length
        ? topicIdProp.rich_text.map((t) => t.plain_text).join('').trim()
        : null;
    return {
        pageId: match.id,
        projectName,
        url: match.url,
        builderAgent: match.properties['Builder Agent']?.select?.name || null,
        topicId,
    };
}
async function updateNotionProject(pageId, data) {
    const { commitMessage, commitSha, commitUrl, branchName, authorName, commitTimestamp, changedFilesText, filesChangedCount, riskLevel, deploymentStatus, buildProvider, buildUrl, currentProjectState, lastBuildError, highRiskFlag, highRiskReason, } = data;
    const now = new Date().toISOString();
    const allProperties = {};
    if (commitMessage !== undefined)
        allProperties['Last Commit Message'] = { rich_text: [{ text: { content: String(commitMessage).substring(0, 2000) } }] };
    if (commitSha !== undefined)
        allProperties['Last Commit Hash'] = { rich_text: [{ text: { content: String(commitSha).substring(0, 100) } }] };
    if (commitUrl !== undefined)
        allProperties['Last Commit URL'] = { url: commitUrl || null };
    if (branchName !== undefined)
        allProperties['Last Branch'] = { rich_text: [{ text: { content: String(branchName).substring(0, 100) } }] };
    if (authorName !== undefined)
        allProperties['Last Commit Author'] = { rich_text: [{ text: { content: String(authorName).substring(0, 100) } }] };
    if (commitTimestamp !== undefined)
        allProperties['Last Commit Date'] = { date: { start: commitTimestamp } };
    if (changedFilesText !== undefined)
        allProperties['Changed Files'] = { rich_text: [{ text: { content: String(changedFilesText).substring(0, 2000) } }] };
    if (filesChangedCount !== undefined)
        allProperties['Files Changed Count'] = { number: filesChangedCount };
    if (riskLevel !== undefined)
        allProperties['Risk Level'] = { select: { name: riskLevel } };
    allProperties['Last Updated'] = { date: { start: now } };
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
            page_id: pageId,
            properties: allProperties,
        });
        logger_1.default.info({ pageId }, 'Notion bulk update succeeded');
        bustNotionCache();
        return;
    }
    catch (bulkErr) {
        logger_1.default.warn({ err: bulkErr.message }, 'Bulk Notion update failed — falling back to field-by-field');
    }
    let successCount = 0;
    for (const [fieldName, value] of Object.entries(allProperties)) {
        try {
            await getClient().pages.update({
                page_id: pageId,
                properties: { [fieldName]: value },
            });
            successCount++;
        }
        catch (fieldErr) {
            logger_1.default.warn({ field: fieldName, err: fieldErr.message }, 'Skipping Notion field — may not exist in database');
        }
    }
    if (successCount === 0) {
        throw new Error('All Notion field updates failed — check API key and database permissions');
    }
    logger_1.default.info({ pageId, successCount, total: Object.keys(allProperties).length }, 'Notion field-by-field update complete');
    bustNotionCache();
}
async function appendChangelog(pageId, data) {
    const { commitTimestamp, projectName, repoName, branchName, commitSha, authorName, commitMessage, filesChangedCount, isMarketingOnlyUpdate, commitUrl, riskLevel, } = data;
    const dateStr = new Date(commitTimestamp).toUTCString();
    const shortSha = commitSha.substring(0, 7);
    const entryText = `Sentinel Update — ${dateStr}

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
                type: 'callout',
                callout: {
                    rich_text: [
                        {
                            type: 'text',
                            text: { content: entryText.substring(0, 2000) },
                        },
                    ],
                    icon: { emoji: '📝' },
                    color: 'gray_background',
                },
            },
        ],
    });
    bustNotionCache();
}
async function updateBuilderAgent(pageId, agentId) {
    await getClient().pages.update({
        page_id: pageId,
        properties: { 'Builder Agent': { select: { name: agentId } } },
    });
}
function bustNotionCache() {
    notionPageCache.pages = null;
    notionPageCache.cachedAt = 0;
}
module.exports = { findNotionProject, updateNotionProject, appendChangelog, updateBuilderAgent, bustNotionCache };
//# sourceMappingURL=notionClient.js.map