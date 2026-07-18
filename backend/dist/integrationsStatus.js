"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("./logger"));
async function ping(name, fn) {
    try {
        const result = await fn();
        return { name, status: 'connected', detail: result || null };
    }
    catch (err) {
        logger_1.default.warn({ name, err: err.message }, 'Integration probe failed');
        return { name, status: 'error', detail: err.message };
    }
}
async function checkGitHub() {
    if (!process.env['GITHUB_ORG'] || !process.env['GITHUB_WEBHOOK_SECRET']) {
        return { name: 'GitHub', status: 'unconfigured', detail: 'GITHUB_ORG or GITHUB_WEBHOOK_SECRET not set' };
    }
    return ping('GitHub', async () => {
        const headers = process.env['GITHUB_TOKEN']
            ? { Authorization: `token ${process.env['GITHUB_TOKEN']}` }
            : {};
        const res = await axios_1.default.get(`https://api.github.com/users/${process.env['GITHUB_ORG']}`, {
            headers, timeout: 5000,
        });
        return `org: ${res.data.login}`;
    });
}
async function checkTelegram() {
    if (!process.env['TELEGRAM_BOT_TOKEN']) {
        return { name: 'Telegram', status: 'unconfigured', detail: 'TELEGRAM_BOT_TOKEN not set' };
    }
    return ping('Telegram', async () => {
        const res = await axios_1.default.get(`https://api.telegram.org/bot${process.env['TELEGRAM_BOT_TOKEN']}/getMe`, { timeout: 5000 });
        return `bot: @${res.data.result?.username}`;
    });
}
async function checkNotion() {
    if (!process.env['NOTION_API_KEY'] || !process.env['NOTION_DATABASE_ID']) {
        return { name: 'Notion', status: 'unconfigured', detail: 'NOTION_API_KEY or NOTION_DATABASE_ID not set' };
    }
    return ping('Notion', async () => {
        await axios_1.default.get(`https://api.notion.com/v1/databases/${process.env['NOTION_DATABASE_ID']}`, {
            headers: {
                Authorization: `Bearer ${process.env['NOTION_API_KEY']}`,
                'Notion-Version': '2022-06-28',
            },
            timeout: 5000,
        });
        return 'database reachable';
    });
}
async function checkRailway() {
    if (!process.env['RAILWAY_TOKEN']) {
        return { name: 'Railway', status: 'unconfigured', detail: 'RAILWAY_TOKEN not set' };
    }
    return ping('Railway', async () => {
        const res = await axios_1.default.post('https://backboard.railway.app/graphql/v2', { query: '{ me { name } }' }, {
            headers: {
                Authorization: `Bearer ${process.env['RAILWAY_TOKEN']}`,
                'Content-Type': 'application/json',
            },
            timeout: 5000,
        });
        const name = res.data?.data?.me?.name;
        return name ? `user: ${name}` : 'reachable';
    });
}
async function getIntegrationsStatus() {
    const [github, telegram, notion, railway] = await Promise.all([
        checkGitHub(),
        checkTelegram(),
        checkNotion(),
        checkRailway(),
    ]);
    return { connectors: [github, telegram, notion, railway] };
}
module.exports = { getIntegrationsStatus };
//# sourceMappingURL=integrationsStatus.js.map