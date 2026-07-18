"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const https_1 = __importDefault(require("https"));
const logger_1 = __importDefault(require("./logger"));
const settingsLoader_1 = require("./settingsLoader");
const MAX_LENGTH = 4096;
// Topic ID mapping: repo name (lowercase) → Telegram topic ID
const TOPIC_MAP = {
    'project-sentinel': parseInt(process.env['TOPIC_PROJECT_SENTINEL'] || '0', 10),
    'acc': parseInt(process.env['TOPIC_ACC'] || '0', 10),
    'alphonsoecosystem': parseInt(process.env['TOPIC_ALPHONSOECOSYSTEM'] || '0', 10),
    'shiporex': parseInt(process.env['TOPIC_SHIPOREX'] || '0', 10),
    'project-aegis-launch-site': parseInt(process.env['TOPIC_PROJECT_AEGIS'] || '0', 10),
    'tapcash': parseInt(process.env['TOPIC_TAPCASH'] || '0', 10),
    'sessionguard': parseInt(process.env['TOPIC_SESSIONGUARD'] || '0', 10),
    'costpilot': parseInt(process.env['TOPIC_COSTPILOT'] || '0', 10),
    'mint': parseInt(process.env['TOPIC_MINT'] || '0', 10),
    'obsidianstudio': parseInt(process.env['TOPIC_OBSIDIANSTUDIO'] || '0', 10),
    'obsidianmedia': parseInt(process.env['TOPIC_OBSIDIANMEDIA'] || '0', 10),
};
function getTopicId(repoName) {
    const key = (repoName || '').toLowerCase();
    const topicId = TOPIC_MAP[key];
    return (topicId && topicId > 0) ? topicId : null;
}
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
async function sendTelegramMessage(text, repoName, explicitTopicId, forceSend = false) {
    const BOT_TOKEN = process.env['TELEGRAM_BOT_TOKEN'];
    const CHAT_ID = process.env['TELEGRAM_CHAT_ID'];
    if (!BOT_TOKEN || !CHAT_ID) {
        logger_1.default.warn('Telegram credentials not configured — skipping message');
        return;
    }
    // Check if telegram alerts are enabled in settings (unless forceSend)
    if (!forceSend) {
        try {
            const settings = await (0, settingsLoader_1.loadSettings)();
            if (!settings.telegram_alerts) {
                logger_1.default.debug('Telegram alerts disabled in settings');
                return;
            }
        }
        catch (err) {
            logger_1.default.warn({ err: err.message }, 'Could not check telegram alerts setting, sending anyway');
        }
    }
    const safeText = text.length > MAX_LENGTH
        ? text.substring(0, MAX_LENGTH - 30) + '\n\n[message truncated]'
        : text;
    const escapedText = escapeHtml(safeText);
    const body = {
        chat_id: CHAT_ID,
        text: escapedText,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
    };
    let topicId = explicitTopicId;
    if (!topicId && repoName) {
        topicId = getTopicId(repoName);
    }
    if (topicId) {
        body.message_thread_id = topicId;
    }
    const bodyJson = JSON.stringify(body);
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${BOT_TOKEN}/sendMessage`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyJson),
            },
        };
        const req = https_1.default.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (!parsed.ok) {
                        logger_1.default.error({ code: parsed.error_code, desc: parsed.description }, 'Telegram API returned error');
                        reject(new Error(`Telegram: ${parsed.description}`));
                    }
                    else {
                        resolve(parsed);
                    }
                }
                catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Telegram request timed out after 10s'));
        });
        req.write(bodyJson);
        req.end();
    });
}
// Registers Telegram's native "/" command menu
async function registerBotCommands() {
    const BOT_TOKEN = process.env['TELEGRAM_BOT_TOKEN'];
    if (!BOT_TOKEN) {
        logger_1.default.warn('TELEGRAM_BOT_TOKEN not set — skipping bot command menu registration');
        return;
    }
    const commands = [
        { command: 'start', description: 'Open the Sentinel quick-actions menu' },
        { command: 'menu', description: 'Open the Sentinel quick-actions menu' },
        { command: 'help', description: 'Full command reference' },
        { command: 'sentinel', description: 'Run a Sentinel command, e.g. /sentinel health' },
    ];
    const bodyJson = JSON.stringify({ commands });
    return new Promise((resolve) => {
        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${BOT_TOKEN}/setMyCommands`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyJson),
            },
        };
        const req = https_1.default.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (!parsed.ok) {
                        logger_1.default.warn({ desc: parsed.description }, 'setMyCommands failed');
                    }
                    else {
                        logger_1.default.info('Telegram bot command menu registered');
                    }
                }
                catch (e) {
                    logger_1.default.warn({ err: e.message }, 'setMyCommands response parse failed');
                }
                resolve();
            });
        });
        req.on('error', (err) => {
            logger_1.default.warn({ err: err.message }, 'setMyCommands request failed');
            resolve();
        });
        req.setTimeout(10000, () => { req.destroy(); resolve(); });
        req.write(bodyJson);
        req.end();
    });
}
module.exports = { sendTelegramMessage, getTopicId, registerBotCommands };
//# sourceMappingURL=telegramClient.js.map