"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const safeFire_1 = require("./utils/safeFire");
const logger_1 = __importDefault(require("./logger"));
const agentBots_1 = require("./agentBots");
const telegramAI_1 = require("./telegramAI");
// Telegram bot username (lowercase, no @) → agent ID
const BOT_USERNAME_TO_AGENT = {
    nemotronsintel: 'nvidia', // @nemotronsintelbot
    qwencodersintenel: 'qwen_coder', // @qwencodersintenelbot (typo in username)
    qwendashsentinel: 'qwen_coder_dash', // @qwendashsentinelbot
    geminisentinel: 'gemini', // @geminisentinelbot
    deepseeksentinel: 'deepseek', // @deepseeksentinelBot
    // qwen_max, qwen_turbo, llama_fast — bots not yet created, fall back to Sentinel bot
};
// Returns agent ID if the message is a reply to a specific agent bot, else null
function detectAgentReply(message) {
    const replyTo = message?.reply_to_message;
    if (!replyTo)
        return null;
    const botUsername = replyTo.from?.username?.toLowerCase();
    if (!botUsername)
        return null;
    // Strip trailing 'bot' suffix if present (e.g. sentinelnemotronbot → sentinelnemotron)
    const normalized = botUsername.replace(/bot$/, '');
    return BOT_USERNAME_TO_AGENT[normalized] || BOT_USERNAME_TO_AGENT[botUsername] || null;
}
// Route a message that is a reply to a specific agent
async function handleAgentReply(message, agentId, topicId) {
    const text = message.text || '';
    const fromName = message.from?.first_name || message.from?.username || 'Shayan';
    const messageId = message.message_id;
    logger_1.default.info({ agentId, text: text.substring(0, 80) }, 'Direct agent reply received');
    try {
        const { getAgentRoomSummary } = require('./agentRoom');
        const { getAllAgents } = require('./agentDb');
        const [agents] = await Promise.all([
            getAllAgents().catch(() => []),
        ]);
        const thisAgent = agents.find((a) => a.agent_id === agentId);
        const agentContext = thisAgent
            ? `You are specifically being addressed as ${thisAgent.agent_label}. ` +
                `Your current status: ${thisAgent.status}. ` +
                (thisAgent.task_title
                    ? `You are working on: ${thisAgent.task_title}`
                    : 'You are currently idle.')
            : `You are being directly addressed as agent: ${agentId}`;
        // handleMessage(text, fromName, topicId, roomContext, targetAgentId, agentContext, replyToMessageId)
        await (0, telegramAI_1.handleMessage)(text, fromName, topicId, undefined, agentId, agentContext, messageId);
    }
    catch (err) {
        logger_1.default.error({ err: err.stack ?? err.message, agentId }, 'Agent reply handling failed');
        await (0, safeFire_1.safeFire)((0, agentBots_1.sendAsAgent)(agentId, 'Sorry, I had trouble processing that. Try again or use /sentinel agents.', messageId), { label: 'agentReplies' });
    }
}
module.exports = { detectAgentReply, handleAgentReply };
//# sourceMappingURL=agentReplies.js.map