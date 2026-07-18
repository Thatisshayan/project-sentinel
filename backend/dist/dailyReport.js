"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const telegramClient_1 = require("./telegramClient");
const portfolioAnalytics_1 = require("./portfolioAnalytics");
const portfolioDb_1 = require("./portfolioDb");
const dbClient_1 = require("./dbClient");
const securityDb_1 = require("./securityDb");
const logger_1 = __importDefault(require("./logger"));
const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const STATUS_EMOJI = { passing: '🟢', failed: '🔴', unknown: '⚪', building: '🟡' };
const PRIORITY_EMOJI = { critical: '🚨', high: '⚠️', medium: '📋', low: '💤' };
async function buildReportMessage(summary, patterns) {
    const { metrics, avgHealth, dailyCost, monthlyCost, healthy, broken, unknown } = summary;
    const today = new Date().toLocaleDateString('en-CA', {
        timeZone: 'America/Toronto',
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    const sorted = [...metrics].sort((a, b) => {
        const pa = PRIORITY_ORDER[a.priority] ?? 2;
        const pb = PRIORITY_ORDER[b.priority] ?? 2;
        if (pa !== pb)
            return pa - pb;
        return parseFloat(b.health_score) - parseFloat(a.health_score);
    });
    const repoLines = sorted.map((m) => {
        const status = STATUS_EMOJI[m.build_status] || '⚪';
        const pri = PRIORITY_EMOJI[m.priority] || '📋';
        const tasks = m.tasks_queued > 0 ? ` · ${m.tasks_queued} tasks queued` : '';
        const fails = m.builds_failed > 0
            ? ` · ${m.builds_failed} fail${m.builds_failed > 1 ? 's' : ''}` : '';
        return `${status} ${pri} ${m.repo_name}${fails}${tasks}`;
    }).join('\n');
    const totalTasksDone = metrics.reduce((s, m) => s + (m.tasks_done || 0), 0);
    const totalTasksQueued = metrics.reduce((s, m) => s + (m.tasks_queued || 0), 0);
    const totalBuildsPassed = metrics.reduce((s, m) => s + (m.builds_passed || 0), 0);
    const totalBuildsFailed = metrics.reduce((s, m) => s + (m.builds_failed || 0), 0);
    const patternLines = patterns.length > 0
        ? '\n🔍 Cross-repo patterns detected:\n' +
            patterns.slice(0, 3).map((p) => `  · ${p.description} (${p.affected_repos?.length || 0} repos)`).join('\n')
        : '';
    const costLine = dailyCost > 0
        ? `\n💰 API spend: $${dailyCost.toFixed(2)} today · $${monthlyCost.toFixed(2)} this month`
        : '';
    return [
        `🛡️ Project Sentinel — Daily Report`,
        `${today}`,
        ``,
        `Portfolio Health: ${avgHealth}/10`,
        `🟢 ${healthy.length} healthy  🔴 ${broken.length} broken  ⚪ ${unknown.length} unknown`,
        ``,
        `REPOS:`,
        repoLines,
        ``,
        `ACTIVITY (last 24h):`,
        `✅ ${totalBuildsPassed} builds passed  ❌ ${totalBuildsFailed} failed`,
        `🔧 ${totalTasksDone} tasks completed  📋 ${totalTasksQueued} queued`,
        patternLines,
        costLine,
        ``,
        `Quick commands:`,
        `/sentinel execute <repo>  — run pending tasks`,
        `/sentinel audit <repo>    — trigger manual audit`,
        `/sentinel status <repo>   — repo details`,
    ].filter((l) => l !== null).join('\n');
}
async function sendDailyReport() {
    logger_1.default.info('Generating daily portfolio report');
    try {
        const [summary, patterns] = await Promise.all([
            (async () => { await (0, portfolioAnalytics_1.refreshAllMetrics)(); return (0, portfolioAnalytics_1.getPortfolioSummary)(); })(),
            (0, portfolioDb_1.getOpenPatterns)(),
        ]);
        let message = await buildReportMessage(summary, patterns);
        const dailyCost = await (0, portfolioDb_1.getDailyCost)();
        const monthlyCost = await (0, portfolioDb_1.getMonthlyCost)();
        const secPortfolio = await (0, securityDb_1.getPortfolioSecuritySummary)().catch(() => []);
        const criticalRepos = secPortfolio.filter((r) => r.critical_count > 0);
        if (criticalRepos.length > 0) {
            message += '\n\n🔒 Security Alerts:\n' +
                criticalRepos.map((r) => `  · ${r.repo_name}: ${r.critical_count} critical open`).join('\n');
        }
        await (0, telegramClient_1.sendTelegramMessage)(message, null, null);
        const today = new Date().toISOString().split('T')[0];
        await (0, dbClient_1.query)(`
      INSERT INTO daily_reports
        (report_date, health_average, builds_passed, builds_failed,
         tasks_completed, daily_cost, monthly_cost, telegram_sent, sent_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,true,NOW())
      ON CONFLICT (report_date) DO UPDATE SET
        health_average = EXCLUDED.health_average,
        telegram_sent  = true,
        sent_at        = NOW()
    `, [
            today,
            summary.avgHealth,
            summary.metrics.reduce((s, m) => s + (m.builds_passed || 0), 0),
            summary.metrics.reduce((s, m) => s + (m.builds_failed || 0), 0),
            summary.metrics.reduce((s, m) => s + (m.tasks_done || 0), 0),
            dailyCost, monthlyCost,
        ]);
        logger_1.default.info('Daily report sent');
    }
    catch (err) {
        logger_1.default.error({ err: err.stack ?? err.message }, 'Daily report failed');
    }
}
module.exports = { sendDailyReport };
//# sourceMappingURL=dailyReport.js.map