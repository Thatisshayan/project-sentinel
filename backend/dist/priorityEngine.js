"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const safeFire_1 = require("./utils/safeFire");
const logger_1 = __importDefault(require("./logger"));
const dbClient_1 = require("./dbClient");
const telegramClient_1 = require("./telegramClient");
const notionClient_1 = require("./notionClient");
const ESCALATION_RULES = [
    { metric: 'daily_active_users', dropPct: 20, newPriority: 'critical', reason: 'DAU dropped' },
    { metric: 'revenue_total', dropPct: 15, newPriority: 'critical', reason: 'Revenue dropped' },
    { metric: 'conversion_rate', dropPct: 25, newPriority: 'high', reason: 'Conversion dropped' },
    { metric: 'fraud_alerts', riseAbs: 5, newPriority: 'critical', reason: 'Fraud spike' },
];
async function getMetricPair(repoName, metricName) {
    const r = await (0, dbClient_1.query)(`
    SELECT metric_value, recorded_date
    FROM business_metrics
    WHERE repo_name = $1 AND metric_name = $2
    ORDER BY recorded_date DESC
    LIMIT 2
  `, [repoName, metricName]).catch(() => null);
    return r?.rows || [];
}
async function updateNotionPriority(repoName, priority) {
    try {
        const { Client } = require('@notionhq/client');
        const notion = new Client({ auth: process.env['NOTION_API_KEY'] });
        const project = await (0, notionClient_1.findNotionProject)(repoName).catch(() => null);
        if (!project?.pageId)
            return;
        await notion.pages.update({
            page_id: project.pageId,
            properties: { 'Priority': { select: { name: priority } } },
        });
        logger_1.default.info({ repoName, priority }, 'Notion priority updated');
    }
    catch (err) {
        logger_1.default.warn({ err: err.message, repoName }, 'Could not update Notion priority — non-blocking');
    }
}
async function runPriorityEngine() {
    logger_1.default.info('Priority engine running');
    try {
        const reposWithMetrics = (process.env['BUSINESS_METRIC_REPOS'] || 'tapcash')
            .split(',').map((r) => r.trim()).filter(Boolean);
        for (const repoName of reposWithMetrics) {
            for (const rule of ESCALATION_RULES) {
                const rows = await getMetricPair(repoName, rule.metric);
                if (rows.length < 2)
                    continue;
                const todayVal = parseFloat(rows[0].metric_value);
                const yesterdayVal = parseFloat(rows[1].metric_value);
                if (isNaN(todayVal) || isNaN(yesterdayVal))
                    continue;
                let triggered = false;
                let changeDesc = '';
                if (rule.dropPct) {
                    const drop = ((yesterdayVal - todayVal) / Math.abs(yesterdayVal)) * 100;
                    triggered = drop >= rule.dropPct;
                    changeDesc = `dropped ${drop.toFixed(1)}% (threshold: ${rule.dropPct}%)`;
                }
                if (rule.riseAbs) {
                    const rise = todayVal - yesterdayVal;
                    triggered = rise >= rule.riseAbs;
                    changeDesc = `rose by ${rise} (threshold: +${rule.riseAbs})`;
                }
                if (triggered) {
                    logger_1.default.warn({ repoName, metric: rule.metric, reason: rule.reason }, 'Priority escalation triggered');
                    await (0, safeFire_1.safeFire)(updateNotionPriority(repoName, rule.newPriority), { label: 'priorityEngine' });
                    await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)([
                        `⚠️ Priority Escalation — ${repoName}`,
                        ``,
                        `Reason: ${rule.reason}`,
                        `Metric: ${rule.metric} ${changeDesc}`,
                        `Yesterday: ${yesterdayVal}  Today: ${todayVal}`,
                        `New priority: ${rule.newPriority.toUpperCase()}`,
                        ``,
                        `Sprint will prioritise ${repoName} tasks at next cycle.`,
                    ].join('\n'), null, null), { label: 'priorityEngine' });
                }
            }
        }
        logger_1.default.info('Priority engine complete');
    }
    catch (err) {
        logger_1.default.error({ err: err.stack ?? err.message }, 'Priority engine failed');
    }
}
module.exports = { runPriorityEngine };
//# sourceMappingURL=priorityEngine.js.map