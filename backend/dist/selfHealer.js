"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const safeFire_1 = require("./utils/safeFire");
const logger_1 = __importDefault(require("./logger"));
const selfAuditDb_1 = require("./selfAuditDb");
const telegramClient_1 = require("./telegramClient");
async function checkAndHeal() {
    const degraded = await (0, selfAuditDb_1.getDegradedComponents)();
    if (degraded.length === 0)
        return;
    logger_1.default.warn({ count: degraded.length }, 'Degraded components detected');
    const lines = degraded.map((c) => `· ${c.component_name}: ${c.failure_count} failures — ${(c.last_error || '').substring(0, 80)}`).join('\n');
    await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)([
        `🛡️ Sentinel Self-Healing Alert ⚠️`,
        ``,
        `${degraded.length} component(s) degraded:`,
        lines,
        ``,
        `These components are failing repeatedly.`,
        `Sentinel has generated fix tasks — review in Notion.`,
        ``,
        `/sentinel self-approve — approve fix execution`,
    ].join('\n'), null, null), { label: 'selfHealer' });
}
async function reportFailure(componentName, error) {
    await (0, safeFire_1.safeFire)((0, selfAuditDb_1.recordComponentFailure)(componentName, error?.message || String(error)), { label: 'selfHealer' });
    await (0, safeFire_1.safeFire)(checkAndHeal(), { label: 'selfHealer' });
}
async function reportSuccess(componentName) {
    await (0, safeFire_1.safeFire)((0, selfAuditDb_1.recordComponentSuccess)(componentName), { label: 'selfHealer' });
}
module.exports = { reportFailure, reportSuccess, checkAndHeal };
//# sourceMappingURL=selfHealer.js.map