"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const safeFire_1 = require("./utils/safeFire");
const logger_1 = __importDefault(require("./logger"));
const businessDb_1 = require("./businessDb");
const telegramClient_1 = require("./telegramClient");
const dbClient_1 = __importDefault(require("./dbClient"));
async function snapshotBeforeMerge(repoFullName, prNumber, prUrl) {
    const repoName = repoFullName.split('/')[1] || '';
    const metrics = await (0, businessDb_1.getLatestMetrics)(repoName);
    const snapshot = {};
    metrics.forEach((m) => { snapshot[m.metric_name] = parseFloat(m.metric_value); });
    const impactId = await (0, businessDb_1.recordPRImpact)({
        repoFullName,
        prNumber: Number(prNumber),
        prUrl,
        mergedAt: new Date().toISOString(),
        preSnapshot: snapshot,
    });
    if (impactId) {
        setTimeout(async () => {
            await checkPostMergeImpact(impactId, repoName);
        }, 48 * 60 * 60 * 1000);
        logger_1.default.info({ repoFullName, prNumber, impactId }, 'PR impact tracking started');
    }
    return impactId;
}
async function checkPostMergeImpact(impactId, repoName) {
    try {
        const metrics = await (0, businessDb_1.getLatestMetrics)(repoName);
        const snapshot = {};
        metrics.forEach((m) => { snapshot[m.metric_name] = parseFloat(m.metric_value); });
        const { delta, score } = await (0, businessDb_1.updatePRImpact)(impactId, snapshot);
        logger_1.default.info({ impactId, score }, 'PR impact analysis complete');
        if (Math.abs(parseFloat(String(score))) >= 5) {
            const direction = parseFloat(String(score)) > 0 ? 'positive ✅' : 'negative ⚠️';
            const deltaLines = Object.entries(delta).map(([key, d]) => `  ${key}: ${d.before} → ${d.after} (${parseFloat(d.changePercent) > 0 ? '+' : ''}${d.changePercent}%)`).join('\n');
            await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)([
                `📊 PR Impact Analysis — ${repoName}`,
                ``,
                `Impact: ${direction} (score: ${score})`,
                `48h after merge:`,
                deltaLines,
            ].join('\n'), null, null), { label: 'correlationEngine' });
        }
    }
    catch (err) {
        logger_1.default.warn({ err: err.message, impactId }, 'Post-merge impact check failed');
    }
}
async function getCorrelationSummary(repoName) {
    const { query } = dbClient_1.default;
    const r = await query(`
    SELECT
      AVG(impact_score)                                         as avg_impact,
      COUNT(*)                                                  as pr_count,
      SUM(CASE WHEN impact_score > 0 THEN 1 ELSE 0 END)        as positive_prs,
      MAX(impact_score)                                         as best_impact,
      MIN(impact_score)                                         as worst_impact
    FROM pr_impact
    WHERE repo_full_name LIKE $1
      AND analysis_complete = true
      AND merged_at > NOW() - INTERVAL '30 days'
  `, [`%/${repoName}`]);
    return r.rows[0] || null;
}
module.exports = { snapshotBeforeMerge, checkPostMergeImpact, getCorrelationSummary };
//# sourceMappingURL=correlationEngine.js.map