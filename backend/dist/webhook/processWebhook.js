"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processWebhook = processWebhook;
const safeFire_1 = require("../utils/safeFire");
const logger_1 = __importDefault(require("../logger"));
const extractPayload_1 = require("../extractPayload");
const notionClient_1 = require("../notionClient");
const telegramClient_1 = require("../telegramClient");
const deduplication_1 = require("../deduplication");
const queueClient_1 = require("../queueClient");
const dbClient_1 = __importDefault(require("../dbClient"));
const portfolioDb_1 = require("../portfolioDb");
const portfolioAnalytics_1 = require("../portfolioAnalytics");
const messages_1 = require("./messages");
const client_1 = require("@notionhq/client");
const securityScanner_1 = require("../securityScanner");
const crossRepoCoordinator_1 = require("../crossRepoCoordinator");
const { query } = dbClient_1.default;
async function processWebhook(payload) {
    let data;
    try {
        data = (0, extractPayload_1.extractPayload)(payload);
    }
    catch (err) {
        logger_1.default.error({ err: err.stack ?? err.message }, 'Payload extraction failed — cannot process');
        return;
    }
    const { repoName, repoNameLower, commitSha, branchName } = data;
    logger_1.default.info({ repoName, commitSha: commitSha.substring(0, 7), branch: branchName }, 'Processing webhook');
    const seen = await (0, deduplication_1.isAlreadyProcessed)(repoName, commitSha);
    if (seen) {
        logger_1.default.info({ repoName, commitSha: commitSha.substring(0, 7) }, 'Duplicate — skipping');
        return;
    }
    await (0, deduplication_1.markAsProcessed)(repoName, commitSha);
    let notionProject;
    try {
        notionProject = await (0, notionClient_1.findNotionProject)(repoNameLower);
    }
    catch (err) {
        logger_1.default.error({ err: err.stack ?? err.message, repoName }, 'Notion search threw an error');
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)((0, messages_1.buildErrorMessage)('Notion search failed', repoName, err.message), repoName), { label: 'webhook' });
        return;
    }
    if (!notionProject) {
        logger_1.default.warn({ repoName }, 'No matching Notion project');
        let suggestionNote = '';
        try {
            const nc = new client_1.Client({ auth: process.env['NOTION_API_KEY'] });
            const resp = await nc.databases.query({
                database_id: process.env['NOTION_DATABASE_ID'],
                page_size: 20,
            }).catch(() => null);
            if (resp?.results?.length) {
                const names = resp.results.map((p) => {
                    const t = p.properties['Name'] || p.properties['Project'] || p.properties['Title'];
                    return t?.title?.[0]?.plain_text || '(untitled)';
                }).filter(Boolean);
                suggestionNote = `\n\nExisting Notion pages: ${names.join(', ')}\nAdd a "Repo Name" property with value "${repoName}" to the matching page.`;
            }
        }
        catch { }
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)((0, messages_1.buildUnknownRepoMessage)(data) + suggestionNote, repoName), { label: 'webhook' });
        return;
    }
    data.projectName = notionProject.projectName;
    data.notionPageId = notionProject.pageId;
    logger_1.default.info({ repoName, projectName: notionProject.projectName }, 'Matched Notion project');
    try {
        await (0, notionClient_1.updateNotionProject)(notionProject.pageId, data);
    }
    catch (err) {
        logger_1.default.error({ err: err.stack ?? err.message, repoName }, 'Notion update failed');
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)((0, messages_1.buildErrorMessage)('Notion update failed', repoName, err.message), repoName), { label: 'webhook' });
        return;
    }
    let changelogAppended = false;
    try {
        await (0, notionClient_1.appendChangelog)(notionProject.pageId, data);
        changelogAppended = true;
    }
    catch (err) {
        logger_1.default.warn({ err: err.message, repoName }, 'Changelog append failed — continuing');
    }
    try {
        await (0, telegramClient_1.sendTelegramMessage)((0, messages_1.buildSuccessMessage)(data, changelogAppended), repoName);
    }
    catch (err) {
        logger_1.default.error({ err: err.stack ?? err.message, repoName }, 'Telegram send failed');
    }
    await Promise.allSettled([
        (0, portfolioDb_1.upsertRepoMetrics)({
            repoFullName: data.repoFullName,
            repoName: data.repoName,
            lastCommitAt: data.commitTimestamp ? new Date(data.commitTimestamp) : new Date(),
            buildStatus: 'unknown',
            priority: 'medium',
        }).catch((err) => logger_1.default.warn({ err: err.message }, 'Metrics upsert failed')),
        (0, portfolioAnalytics_1.refreshRepoMetrics)(data.repoFullName, data.repoName)
            .catch((err) => logger_1.default.warn({ err: err.message }, 'Post-push metrics refresh failed')),
    ]);
    if (notionProject && data.riskLevel === 'High') {
        try {
            (0, securityScanner_1.runSecurityScan)({
                repoFullName: data.repoFullName,
                repoName: data.repoName,
                commitSha: data.commitSha,
                branchName: data.branchName,
                topicId: notionProject.topicId || null,
            }).catch((err) => logger_1.default.warn({ err: err.message }, 'High-risk security scan failed — non-blocking'));
            logger_1.default.info({ repoName: data.repoName, risk: 'High' }, 'Security scan triggered for high-risk push');
        }
        catch { }
    }
    if (notionProject) {
        try {
            await (0, queueClient_1.enqueueBuildCheck)({
                projectName: notionProject.projectName,
                repoName: data.repoName,
                repoFullName: data.repoFullName,
                branchName: data.branchName,
                commitSha: data.commitSha,
                commitUrl: data.commitUrl,
                commitMessage: data.commitMessage,
                authorName: data.authorName,
                changedFiles: data.changedFiles,
                topicId: notionProject.topicId || null,
            });
            logger_1.default.info({ repoName: data.repoName }, 'Build check job queued');
        }
        catch (err) {
            logger_1.default.warn({ err: err.message }, 'Failed to queue build check — non-blocking');
        }
    }
    logger_1.default.info({ repoName, projectName: notionProject.projectName, changelogAppended }, 'Webhook processing complete');
    try {
        (0, safeFire_1.fireAndForget)((0, crossRepoCoordinator_1.notifyDependents)(repoName, data.commitSha, data.authorName), { label: 'webhook' });
    }
    catch { }
}
//# sourceMappingURL=processWebhook.js.map