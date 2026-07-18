"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const logger_1 = __importDefault(require("./logger"));
const queueClient_1 = require("./queueClient");
const telegramClient_1 = require("./telegramClient");
const sprintOrchestrator_1 = require("./sprintOrchestrator");
const settingsLoader_1 = require("./settingsLoader");
const AUTO_APPROVE_DELAY_MS = 2 * 60 * 60 * 1000; // 2 hours
const REDIS_KEY = 'sentinel:sprint:pending-auto-approve';
async function scheduleAutoApprove(sprintId, topicId) {
    const settings = await (0, settingsLoader_1.loadSettings)();
    if (!settings.auto_approve_tasks)
        return;
    const redis = (0, queueClient_1.getRedisConnection)();
    if (!redis) {
        logger_1.default.warn('Redis not available — auto-approve skipped');
        return;
    }
    await redis.set(REDIS_KEY, JSON.stringify({ sprintId, topicId }), 'PX', AUTO_APPROVE_DELAY_MS);
    logger_1.default.info({ sprintId }, 'Sprint auto-approve scheduled in 2h');
    setTimeout(async () => {
        try {
            const redis2 = (0, queueClient_1.getRedisConnection)();
            if (!redis2)
                return;
            const val = await redis2.get(REDIS_KEY);
            if (!val)
                return;
            const data = JSON.parse(val);
            if (data.sprintId !== sprintId)
                return;
            await redis2.del(REDIS_KEY);
            await (0, telegramClient_1.sendTelegramMessage)('✅ Sprint auto-approved (2h window elapsed). Executing now...', null, data.topicId);
            await (0, sprintOrchestrator_1.approveSprint)(data.topicId);
            logger_1.default.info({ sprintId }, 'Sprint auto-approved');
        }
        catch (err) {
            logger_1.default.error({ err: err.stack ?? err.message }, 'Auto-approve failed');
        }
    }, AUTO_APPROVE_DELAY_MS);
}
async function cancelAutoApprove() {
    const redis = (0, queueClient_1.getRedisConnection)();
    if (!redis)
        return false;
    const val = await redis.get(REDIS_KEY);
    if (!val)
        return false;
    await redis.del(REDIS_KEY);
    logger_1.default.info('Sprint auto-approve cancelled');
    return true;
}
async function isPendingAutoApprove() {
    const redis = (0, queueClient_1.getRedisConnection)();
    if (!redis)
        return false;
    return !!(await redis.get(REDIS_KEY));
}
module.exports = { scheduleAutoApprove, cancelAutoApprove, isPendingAutoApprove };
//# sourceMappingURL=autoApprover.js.map