"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const safeFire_1 = require("./utils/safeFire");
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("./logger"));
const portfolioDb_1 = require("./portfolioDb");
const COSTPILOT_API_URL = () => process.env['COSTPILOT_API_URL'];
const COSTPILOT_API_KEY = () => process.env['COSTPILOT_API_KEY'];
function isConfigured() {
    return !!(COSTPILOT_API_URL() && COSTPILOT_API_KEY());
}
async function logCost(data) {
    if (!isConfigured()) {
        await (0, safeFire_1.safeFire)((0, portfolioDb_1.logApiCost)(data), { label: 'costpilotClient' });
        return;
    }
    try {
        await axios_1.default.post(`${COSTPILOT_API_URL()}/api/events`, {
            service: 'project-sentinel',
            category: data.operation,
            model: data.model,
            repo: data.repoFullName,
            tokens_in: data.inputTokens || 0,
            tokens_out: data.outputTokens || 0,
            cost_usd: data.estimatedCost || 0,
            metadata: {
                task_type: data.operation,
                repo: data.repoFullName,
            },
        }, {
            headers: {
                Authorization: `Bearer ${COSTPILOT_API_KEY()}`,
                'Content-Type': 'application/json',
            },
            timeout: 5000,
        });
    }
    catch (err) {
        logger_1.default.warn({ err: err.message }, 'CostPilot unavailable — using local tracker');
        await (0, safeFire_1.safeFire)((0, portfolioDb_1.logApiCost)(data), { label: 'costpilotClient' });
    }
}
async function getSpendSummary(period = 'today') {
    if (!isConfigured()) {
        const [daily, weekly, monthly] = await Promise.all([(0, portfolioDb_1.getDailyCost)(), (0, portfolioDb_1.getWeeklyCost)(), (0, portfolioDb_1.getMonthlyCost)()]);
        return { daily, weekly, monthly, source: 'local' };
    }
    try {
        const r = await axios_1.default.get(`${COSTPILOT_API_URL()}/api/summary?service=project-sentinel&period=${period}`, {
            headers: { Authorization: `Bearer ${COSTPILOT_API_KEY()}` },
            timeout: 5000,
        });
        return { ...r.data, source: 'costpilot' };
    }
    catch (err) {
        logger_1.default.warn({ err: err.message }, 'CostPilot summary unavailable');
        return { daily: 0, weekly: 0, monthly: 0, source: 'error' };
    }
}
async function getRepoBreakdown(days = 7) {
    if (!isConfigured()) {
        return (0, portfolioDb_1.getCostByRepo)(days).catch(() => []);
    }
    try {
        const r = await axios_1.default.get(`${COSTPILOT_API_URL()}/api/breakdown?service=project-sentinel&days=${days}&group_by=repo`, {
            headers: { Authorization: `Bearer ${COSTPILOT_API_KEY()}` },
            timeout: 5000,
        });
        return r.data.items || [];
    }
    catch (err) {
        logger_1.default.warn({ err: err.message }, 'CostPilot breakdown unavailable');
        return [];
    }
}
module.exports = { logCost, getSpendSummary, getRepoBreakdown, isConfigured };
//# sourceMappingURL=costpilotClient.js.map