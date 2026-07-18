"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const dbClient_1 = require("./dbClient");
const sprintDb_1 = require("./sprintDb");
const portfolioDb_1 = require("./portfolioDb");
const logger_1 = __importDefault(require("./logger"));
function getWeekStart(date = new Date()) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().split('T')[0] || '';
}
async function recordWeeklyVelocity() {
    const weekStart = getWeekStart();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const tasksCompleted = await (0, dbClient_1.query)(`
    SELECT COUNT(*) as count FROM audit_tasks
    WHERE status = 'done' AND updated_at > $1
  `, [weekAgo]);
    const prsMerged = await (0, dbClient_1.query)(`
    SELECT COUNT(*) as count FROM sprint_tasks
    WHERE status = 'done' AND completed_at > $1
  `, [weekAgo]);
    const buildsFixed = await (0, dbClient_1.query)(`
    SELECT COUNT(*) as count FROM debug_attempts
    WHERE status = 'resolved' AND updated_at > $1
  `, [weekAgo]);
    const metrics = await (0, portfolioDb_1.getAllLatestMetrics)();
    const avgHealth = metrics.length > 0
        ? metrics.reduce((s, m) => s + parseFloat(m.health_score || 5), 0) / metrics.length
        : 5.0;
    const trend = await (0, sprintDb_1.getVelocityTrend)(1);
    const lastHealth = trend.length > 0 ? parseFloat(trend[0].avg_health || 5) : 5;
    const healthDelta = avgHealth - lastHealth;
    const apiCost = await (0, portfolioDb_1.getMonthlyCost)();
    await (0, sprintDb_1.recordVelocity)({
        weekStart,
        tasksCompleted: parseInt(tasksCompleted.rows[0]?.count || 0),
        prsMerged: parseInt(prsMerged.rows[0]?.count || 0),
        buildsFixed: parseInt(buildsFixed.rows[0]?.count || 0),
        avgHealth: parseFloat(avgHealth.toFixed(1)),
        healthDelta: parseFloat(healthDelta.toFixed(1)),
        apiCost,
        activeRepos: metrics.filter((m) => m.build_status !== 'unknown').length,
    });
    logger_1.default.info({ weekStart, avgHealth: avgHealth.toFixed(1) }, 'Weekly velocity recorded');
}
async function getVelocityReport() {
    const trend = await (0, sprintDb_1.getVelocityTrend)(4);
    if (trend.length === 0) {
        return 'No velocity data yet — check back after the first sprint completes.';
    }
    const latest = trend[trend.length - 1];
    const arrow = latest.health_delta > 0 ? '↑' : latest.health_delta < 0 ? '↓' : '→';
    const avg4w = trend.reduce((s, t) => s + (t.tasks_completed || 0), 0) / trend.length;
    const lines = trend.map((t) => `  w/o ${t.week_start}: ${t.tasks_completed} tasks · ${t.prs_merged} PRs · health ${t.avg_health}/10`).join('\n');
    return [
        `📈 Velocity Report (last ${trend.length} weeks)`,
        ``,
        lines,
        ``,
        `Latest: health ${latest.avg_health}/10 ${arrow} (${latest.health_delta > 0 ? '+' : ''}${latest.health_delta})`,
        `4-week avg: ${avg4w.toFixed(1)} tasks/week`,
        `API cost this month: $${(latest.api_cost || 0).toFixed(2)}`,
    ].join('\n');
}
module.exports = { recordWeeklyVelocity, getVelocityReport, getWeekStart };
//# sourceMappingURL=velocityTracker.js.map