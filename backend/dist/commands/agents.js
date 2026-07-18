"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const safeFire_1 = require("../utils/safeFire");
const logger_1 = __importDefault(require("../logger"));
const telegramClient_1 = require("../telegramClient");
const repoResolver_1 = require("../repoResolver");
const agentRoom_1 = require("../agentRoom");
const selfAuditor_1 = require("../selfAuditor");
const auditOrchestrator_1 = require("../auditOrchestrator");
async function handleAgentsCmd(subcommand, parts, chatId, topicId) {
    switch (subcommand) {
        case 'agents': {
            const summary = await (0, agentRoom_1.getAgentRoomSummary)();
            await (0, telegramClient_1.sendTelegramMessage)(summary, null, topicId);
            return true;
        }
        case 'agent-room': {
            await (0, telegramClient_1.sendTelegramMessage)(`Agent room topic ID: ${process.env['AGENT_ROOM_TOPIC_ID'] || 'not configured'}\n` +
                `Set AGENT_ROOM_TOPIC_ID in Railway to activate.`, null, topicId);
            return true;
        }
        case 'self-audit': {
            await (0, telegramClient_1.sendTelegramMessage)('Triggering Sentinel self-audit...', null, topicId);
            (0, selfAuditor_1.runSelfAudit)().catch((err) => logger_1.default.error({ err: err.stack ?? err.message }, 'Self-audit failed'));
            return true;
        }
        case 'self-approve': {
            await (0, telegramClient_1.sendTelegramMessage)('Approving Sentinel self-improvement tasks...', null, topicId);
            (0, safeFire_1.fireAndForget)((0, auditOrchestrator_1.executeApprovedTasks)((0, repoResolver_1.repoFullName)('project-sentinel'), 'project-sentinel', topicId), { label: 'agents' });
            return true;
        }
        case 'bots': {
            const { getConfiguredBots } = require('../agentBots');
            const { configured, missing } = getConfiguredBots();
            await (0, telegramClient_1.sendTelegramMessage)([
                `Agent Bot Status:`,
                ``,
                `✅ Configured (${configured.length}): ${configured.join(', ') || 'none'}`,
                `❌ Missing tokens (${missing.length}): ${missing.join(', ') || 'none'}`,
                ``,
                `Add missing tokens to Railway as BOT_TOKEN_<AGENTNAME>`,
            ].join('\n'), null, topicId);
            return true;
        }
        case 'test-bots': {
            const { getConfiguredBots, sendAsAgent } = require('../agentBots');
            const { configured, missing } = getConfiguredBots();
            await (0, telegramClient_1.sendTelegramMessage)(`Testing ${configured.length} agent bots...`, null, topicId);
            for (const agentId of configured) {
                const result = await sendAsAgent(agentId, `🟢 ${agentId} is online and ready.`);
                if (!result) {
                    await (0, telegramClient_1.sendTelegramMessage)(`❌ ${agentId} failed — check bot token and group membership`, null, topicId);
                }
                await new Promise(resolve => setTimeout(resolve, 800));
            }
            if (missing.length > 0) {
                await (0, telegramClient_1.sendTelegramMessage)(`⚠️ Missing tokens for: ${missing.join(', ')}\nAdd BOT_TOKEN_<NAME> to Railway.`, null, topicId);
            }
            return true;
        }
        case 'setup-bots': {
            const { getConfiguredBots, configureBotProfile } = require('../agentBots');
            const { configured } = getConfiguredBots();
            for (const agentId of configured) {
                await configureBotProfile(agentId, `Project Sentinel Agent — ${agentId}`);
            }
            await (0, telegramClient_1.sendTelegramMessage)(`Bot profiles updated for: ${configured.join(', ') || 'none configured'}`, null, topicId);
            return true;
        }
        case 'standup': {
            const { runAgentStandup } = require('../agentStandup');
            await (0, telegramClient_1.sendTelegramMessage)('Running agent standup...', null, topicId);
            runAgentStandup().catch((err) => logger_1.default.error({ err: err.stack ?? err.message }, 'Manual standup failed'));
            return true;
        }
        case 'leaderboard': {
            const { postAgentLeaderboard } = require('../agentLeaderboard');
            postAgentLeaderboard().catch((err) => logger_1.default.error({ err: err.stack ?? err.message }, 'Manual leaderboard failed'));
            return true;
        }
        case 'memory': {
            const { getHistory } = require('../conversationMemory');
            const history = await getHistory(topicId ?? 0, 10).catch(() => []);
            if (history.length === 0) {
                await (0, telegramClient_1.sendTelegramMessage)('No conversation history for this topic yet.', null, topicId);
                return true;
            }
            const lines = history.map((h) => `${h.from_name}: ${h.message.slice(0, 80)}\n→ ${(h.response || '').slice(0, 80)}`);
            await (0, telegramClient_1.sendTelegramMessage)(`Last ${history.length} exchanges:\n\n${lines.join('\n\n')}`, null, topicId);
            return true;
        }
        default:
            return false;
    }
}
module.exports = { handleAgentsCmd };
//# sourceMappingURL=agents.js.map