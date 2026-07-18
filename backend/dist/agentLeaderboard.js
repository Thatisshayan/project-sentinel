"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const logger_1 = __importDefault(require("./logger"));
const agentDb_1 = require("./agentDb");
const telegramClient_1 = require("./telegramClient");
const AGENT_ROOM_TOPIC = () => parseInt(process.env['AGENT_ROOM_TOPIC_ID'] || '494');
async function postAgentLeaderboard() {
    logger_1.default.info('Posting agent leaderboard');
    try {
        const agents = await (0, agentDb_1.getAllAgents)();
        const active = agents.filter((a) => a.status !== 'disabled' && (a.completed_tasks || 0) > 0);
        if (active.length === 0) {
            await (0, telegramClient_1.sendTelegramMessage)('📊 Leaderboard: No activity yet this week.', null, AGENT_ROOM_TOPIC());
            return;
        }
        const ranked = active
            .map((a) => ({
            ...a,
            total: (a.completed_tasks || 0) + (a.failed_tasks || 0),
            successRate: (a.completed_tasks || 0) > 0
                ? Math.round(((a.completed_tasks || 0) / ((a.completed_tasks || 0) + (a.failed_tasks || 0))) * 100)
                : 0,
        }))
            .sort((a, b) => b.completed_tasks - a.completed_tasks || b.successRate - a.successRate);
        const medals = ['🥇', '🥈', '🥉'];
        const week = new Date().toLocaleDateString('en-CA', {
            timeZone: 'America/Toronto', month: 'short', day: 'numeric',
        });
        const lines = [
            `🏆 Agent Leaderboard — Week of ${week}`,
            ``,
            ...ranked.map((a, i) => {
                const medal = medals[i] || `${i + 1}.`;
                return `${medal} ${a.agent_label}: ${a.completed_tasks} tasks, ${a.successRate}% success`;
            }),
            ``,
            `Total tasks this week: ${ranked.reduce((s, a) => s + (a.completed_tasks || 0), 0)}`,
        ];
        await (0, telegramClient_1.sendTelegramMessage)(lines.join('\n'), null, AGENT_ROOM_TOPIC());
        logger_1.default.info('Leaderboard posted');
    }
    catch (err) {
        logger_1.default.error({ err: err.stack ?? err.message }, 'Leaderboard failed');
    }
}
module.exports = { postAgentLeaderboard };
//# sourceMappingURL=agentLeaderboard.js.map