"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const safeFire_1 = require("./utils/safeFire");
const logger_1 = __importDefault(require("./logger"));
const telegramClient_1 = require("./telegramClient");
const portfolioAnalytics_1 = require("./portfolioAnalytics");
const costpilotClient_1 = require("./costpilotClient");
const businessDb_1 = require("./businessDb");
const velocityTracker_1 = require("./velocityTracker");
const correlationEngine_1 = require("./correlationEngine");
const REVENUE_REPOS = ['tapcash', 'acc', 'costpilot'];
async function generateWeeklyReport() {
    logger_1.default.info('Generating weekly business + technical report');
    try {
        const [summary, spend, velocity] = await Promise.all([
            (0, portfolioAnalytics_1.getPortfolioSummary)(),
            (0, costpilotClient_1.getSpendSummary)('week'),
            (0, velocityTracker_1.getVelocityReport)(),
        ]);
        const techLines = [
            `📊 Portfolio Health: ${summary.avgHealth}/10`,
            `✅ Healthy: ${summary.healthy.length}  ❌ Broken: ${summary.broken.length}`,
        ];
        const bizLines = [];
        for (const repoName of REVENUE_REPOS) {
            const metrics = await (0, businessDb_1.getLatestMetrics)(repoName).catch(() => []);
            if (metrics.length === 0)
                continue;
            const revenue = metrics.find((m) => m.metric_name === 'revenue_today');
            const dau = metrics.find((m) => m.metric_name === 'daily_active_users');
            const corr = await (0, correlationEngine_1.getCorrelationSummary)(repoName).catch(() => null);
            const parts = [];
            if (revenue)
                parts.push(`Revenue: $${parseFloat(revenue.metric_value).toFixed(0)}/day`);
            if (dau)
                parts.push(`DAU: ${parseInt(dau.metric_value).toLocaleString()}`);
            if (corr && corr.pr_count > 0) {
                parts.push(`PR impact: ${parseFloat(corr.avg_impact).toFixed(1)} avg score`);
            }
            if (parts.length > 0) {
                bizLines.push(`${repoName}: ${parts.join(' · ')}`);
            }
        }
        const costLines = spend.source !== 'error' ? [
            `💰 API spend this week: $${(spend.weekly || 0).toFixed(2)}`,
            `   Month to date: $${(spend.monthly || 0).toFixed(2)}`,
        ] : [];
        const sorted = [...summary.metrics].sort((a, b) => parseFloat(b.health_score) - parseFloat(a.health_score));
        const topRepo = sorted[0];
        const bottomRepo = sorted[sorted.length - 1];
        const weekOf = new Date().toLocaleDateString('en-CA', {
            timeZone: 'America/Toronto',
            month: 'long', day: 'numeric', year: 'numeric',
        });
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)([
            `🛡️ Sentinel Weekly Report — ${weekOf}`,
            ``,
            `TECHNICAL`,
            ...techLines,
            topRepo ? `📈 Most improved: ${topRepo.repo_name} (${topRepo.health_score}/10)` : null,
            bottomRepo ? `📉 Needs attention: ${bottomRepo.repo_name} (${bottomRepo.health_score}/10)` : null,
            ``,
            bizLines.length > 0 ? 'BUSINESS' : null,
            ...bizLines,
            ``,
            velocity,
            ``,
            ...costLines,
        ].filter((l) => l !== null).join('\n'), null, null), { label: 'weeklyBusinessReport' });
        logger_1.default.info('Weekly business report sent');
    }
    catch (err) {
        logger_1.default.error({ err: err.stack ?? err.message }, 'Weekly business report failed');
    }
}
module.exports = { generateWeeklyReport };
//# sourceMappingURL=weeklyBusinessReport.js.map