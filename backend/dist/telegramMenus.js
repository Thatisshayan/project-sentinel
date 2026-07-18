"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const logger_1 = __importDefault(require("./logger"));
const axios_1 = __importDefault(require("axios"));
const BOT_TOKEN = () => process.env['TELEGRAM_BOT_TOKEN'];
const BASE_URL = () => `https://api.telegram.org/bot${BOT_TOKEN()}`;
async function sendMenu(chatId, threadId, text, buttons) {
    await axios_1.default.post(`${BASE_URL()}/sendMessage`, {
        chat_id: chatId,
        text,
        message_thread_id: threadId || undefined,
        reply_markup: {
            inline_keyboard: buttons,
        },
    }).catch((err) => logger_1.default.warn({ err: err.message }, 'Menu send failed'));
}
async function showMainMenu(chatId, threadId) {
    await sendMenu(chatId, threadId, '🛡️ Sentinel — Quick Actions', [
        [
            { text: '📊 Report', callback_data: 'menu:report' },
            { text: '💰 Costs', callback_data: 'menu:costs' },
            { text: '🤖 Agents', callback_data: 'menu:agents' },
        ],
        [
            { text: '🏃 Sprint', callback_data: 'menu:sprint' },
            { text: '🛡️ Self-Audit', callback_data: 'menu:selfaudit' },
            { text: '🔒 Security', callback_data: 'menu:security' },
        ],
        [
            { text: '✅ Approvals', callback_data: 'menu:approvals' },
            { text: '📋 Last 5', callback_data: 'menu:last' },
            { text: '❓ Help', callback_data: 'menu:help' },
        ],
    ]);
}
async function showRepoMenu(chatId, threadId, repoName) {
    await sendMenu(chatId, threadId, `📁 ${repoName} — Actions`, [
        [
            { text: '📊 Status', callback_data: `repo:status:${repoName}` },
            { text: '🔍 Audit', callback_data: `repo:audit:${repoName}` },
        ],
        [
            { text: '⚡ Execute', callback_data: `repo:execute:${repoName}` },
            { text: '🔒 Security', callback_data: `repo:security:${repoName}` },
        ],
        [
            { text: '⏹ Stop', callback_data: `repo:stop:${repoName}` },
            { text: '🔐 Lock', callback_data: `repo:lock:${repoName}` },
        ],
    ]);
}
async function showApprovalsMenu(chatId, threadId, pending) {
    const buttons = [];
    if (pending.sprint)
        buttons.push([
            { text: '✅ Approve Sprint', callback_data: 'approve:sprint' },
            { text: '⏭ Skip Sprint', callback_data: 'approve:skip-sprint' },
        ]);
    if (pending.selfAudit)
        buttons.push([
            { text: '✅ Self-Approve', callback_data: 'approve:self' },
        ]);
    if (pending.security)
        buttons.push([
            { text: `🔒 Security Approve ${pending.security}`, callback_data: `approve:security:${pending.security}` },
        ]);
    if (buttons.length === 0) {
        await sendMenu(chatId, threadId, '✅ No pending approvals.', []);
        return;
    }
    await sendMenu(chatId, threadId, '⏳ Pending Approvals', buttons);
}
async function showDidYouMean(chatId, threadId, suggestions) {
    const buttons = suggestions.map((s) => [
        { text: s.label, callback_data: `dym:${s.action}` }
    ]);
    buttons.push([{ text: '❌ Never mind', callback_data: 'dym:cancel' }]);
    await sendMenu(chatId, threadId, '🤔 Did you mean...?', buttons);
}
module.exports = { showMainMenu, showRepoMenu, showApprovalsMenu, showDidYouMean, sendMenu };
//# sourceMappingURL=telegramMenus.js.map