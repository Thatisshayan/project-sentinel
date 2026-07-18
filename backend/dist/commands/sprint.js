"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const safeFire_1 = require("../utils/safeFire");
const logger_1 = __importDefault(require("../logger"));
const telegramClient_1 = require("../telegramClient");
const sprintOrchestrator_1 = require("../sprintOrchestrator");
async function handleSprintCmd(subcommand, parts, chatId, topicId) {
    switch (subcommand) {
        case 'approve-sprint': {
            (0, sprintOrchestrator_1.approveSprint)(topicId)
                .catch((err) => logger_1.default.error({ err: err.stack ?? err.message }, 'approve-sprint failed'));
            return true;
        }
        case 'skip-sprint': {
            const { getCurrentSprint, updateSprint } = require('../sprintDb');
            const sprint = await getCurrentSprint();
            if (sprint) {
                await updateSprint(sprint.id, { status: 'skipped' });
                await (0, telegramClient_1.sendTelegramMessage)('Sprint skipped. Next proposal Sunday 8pm.', null, topicId);
            }
            else {
                await (0, telegramClient_1.sendTelegramMessage)('No active sprint proposal to skip.', null, topicId);
            }
            return true;
        }
        case 'sprint-status': {
            (0, safeFire_1.fireAndForget)((0, sprintOrchestrator_1.getSprintStatus)(topicId), { label: 'sprint' });
            return true;
        }
        case 'pause-sprint': {
            (0, safeFire_1.fireAndForget)((0, sprintOrchestrator_1.pauseSprint)(topicId), { label: 'sprint' });
            return true;
        }
        case 'resume-sprint': {
            (0, safeFire_1.fireAndForget)((0, sprintOrchestrator_1.resumeSprint)(topicId), { label: 'sprint' });
            return true;
        }
        case 'propose-sprint': {
            const { generateSprintProposal } = require('../sprintPlanner');
            await (0, telegramClient_1.sendTelegramMessage)('Generating sprint proposal...', null, topicId);
            generateSprintProposal().catch((err) => logger_1.default.error({ err: err.stack ?? err.message }, 'Manual sprint proposal failed'));
            return true;
        }
        case 'run-sprint': {
            const { getCurrentSprint } = require('../sprintDb');
            const sprint = await getCurrentSprint().catch(() => null);
            if (!sprint) {
                await (0, telegramClient_1.sendTelegramMessage)('No active sprint. Propose one: /sentinel propose-sprint', null, topicId);
                return true;
            }
            if (sprint.status === 'proposed') {
                await (0, telegramClient_1.sendTelegramMessage)(`Sprint is pending approval. Use /sentinel approve-sprint to approve and start it.`, null, topicId);
                return true;
            }
            if (sprint.status === 'executing') {
                const { executeNextSprintTask } = require('../sprintOrchestrator');
                await (0, telegramClient_1.sendTelegramMessage)(`Resuming sprint execution (${sprint.total_tasks} tasks)...`, null, topicId);
                (0, safeFire_1.fireAndForget)(executeNextSprintTask(sprint.id, topicId), { label: 'sprint' });
                return true;
            }
            await (0, telegramClient_1.sendTelegramMessage)(`Sprint status: ${sprint.status}. Nothing to run.`, null, topicId);
            return true;
        }
        default:
            return false;
    }
}
module.exports = { handleSprintCmd };
//# sourceMappingURL=sprint.js.map