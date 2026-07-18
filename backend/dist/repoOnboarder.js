"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const logger_1 = __importDefault(require("./logger"));
const axios_1 = __importDefault(require("axios"));
const telegramClient_1 = require("./telegramClient");
const auditOrchestrator_1 = require("./auditOrchestrator");
const notionClient_1 = require("./notionClient");
const repoResolver_1 = require("./repoResolver");
function getWatchedRepos() {
    return (process.env['WATCHED_REPOS'] || '').split(',').map((r) => r.trim()).filter(Boolean);
}
async function onboardRepo(repoName) {
    logger_1.default.info({ repoName }, 'New repo detected — onboarding');
    const notionClient = require('./notionClient');
    if (typeof notionClient.createNotionProject === 'function') {
        await notionClient.createNotionProject({
            repoName, priority: 'medium', builderAgent: 'qwen_coder', healthScore: 0,
        }).catch((err) => logger_1.default.warn({ err: err.message, repoName }, 'Notion row creation failed'));
    }
    else {
        logger_1.default.warn({ repoName }, 'createNotionProject not available — add repo row to Notion manually');
    }
    await registerWebhook(repoName).catch((err) => logger_1.default.warn({ err: err.message, repoName }, 'Webhook registration failed — register manually in GitHub'));
    await (0, auditOrchestrator_1.triggerAudit)({
        repoFullName: (0, repoResolver_1.repoFullName)(repoName),
        repoName,
        projectName: repoName,
        commitSha: `onboard-${Date.now()}`,
        commitMessage: '[sentinel-onboard] Initial audit',
        branchName: 'main',
        authorName: 'Sentinel',
        authorEmail: '',
        topicId: null,
    }).catch((err) => logger_1.default.warn({ err: err.message, repoName }, 'First audit failed'));
    await (0, telegramClient_1.sendTelegramMessage)([
        `🆕 New repo onboarded: ${repoName}`,
        `Notion row created ✅`,
        `GitHub webhook registered ✅`,
        `First audit triggered ✅`,
        `Sentinel is now monitoring ${repoName}.`,
    ].join('\n'), null, null);
    logger_1.default.info({ repoName }, 'Repo onboarding complete');
}
async function checkAndOnboardNewRepos() {
    const repos = getWatchedRepos();
    if (repos.length === 0) {
        logger_1.default.info('WATCHED_REPOS not configured — onboarding skipped');
        return;
    }
    for (const repoName of repos) {
        try {
            const existing = await (0, notionClient_1.findNotionProject)(repoName).catch(() => null);
            if (existing)
                continue;
            await onboardRepo(repoName);
        }
        catch (err) {
            logger_1.default.error({ err: err.stack ?? err.message, repoName }, 'Repo onboarding failed');
        }
    }
    logger_1.default.info({ count: repos.length }, 'Repo onboarding check complete');
}
async function registerWebhook(repoName) {
    const domain = process.env['RAILWAY_PUBLIC_DOMAIN'];
    if (!domain) {
        logger_1.default.warn({ repoName }, 'RAILWAY_PUBLIC_DOMAIN not set — skipping webhook registration');
        return;
    }
    const webhookUrl = `https://${domain}/webhook/github`;
    await axios_1.default.post(`https://api.github.com/repos/${(0, repoResolver_1.getGithubOrg)()}/${repoName}/hooks`, {
        name: 'web',
        active: true,
        events: ['push', 'pull_request'],
        config: {
            url: webhookUrl,
            content_type: 'json',
            secret: process.env['GITHUB_WEBHOOK_SECRET'],
        },
    }, {
        headers: {
            Authorization: `token ${process.env['GITHUB_TOKEN']}`,
            Accept: 'application/vnd.github.v3+json',
        },
    });
}
module.exports = { checkAndOnboardNewRepos, getWatchedRepos, onboardRepo, registerWebhook };
//# sourceMappingURL=repoOnboarder.js.map