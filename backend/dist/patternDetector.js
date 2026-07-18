"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const safeFire_1 = require("./utils/safeFire");
const logger_1 = __importDefault(require("./logger"));
const dbClient_1 = require("./dbClient");
const portfolioDb_1 = require("./portfolioDb");
const telegramClient_1 = require("./telegramClient");
const PATTERN_THRESHOLD = () => parseInt(process.env['PATTERN_DETECTION_THRESHOLD'] || '3');
async function detectPatterns() {
    logger_1.default.info('Running cross-repo pattern detection');
    const detected = [];
    const failurePatterns = await (0, dbClient_1.query)(`
    SELECT
      LOWER(SUBSTRING(failure_reason, 1, 100)) as pattern,
      ARRAY_AGG(DISTINCT repo_full_name) as repos,
      COUNT(DISTINCT repo_full_name) as repo_count
    FROM debug_attempts
    WHERE created_at > NOW() - INTERVAL '7 days'
      AND failure_reason IS NOT NULL
      AND failure_reason != ''
      AND status IN ('failed','exhausted')
    GROUP BY LOWER(SUBSTRING(failure_reason, 1, 100))
    HAVING COUNT(DISTINCT repo_full_name) >= $1
    ORDER BY repo_count DESC
    LIMIT 10
  `, [PATTERN_THRESHOLD()]);
    for (const row of failurePatterns.rows) {
        await (0, portfolioDb_1.upsertPattern)({
            patternType: 'error',
            patternKey: `error:${row.pattern}`,
            description: `Build failure: "${row.pattern.substring(0, 80)}"`,
            affectedRepos: row.repos,
            severity: row.repo_count >= 5 ? 'high' : 'medium',
        });
        detected.push({ type: 'error', repos: row.repos, description: row.pattern });
    }
    const taskPatterns = await (0, dbClient_1.query)(`
    SELECT
      category,
      priority,
      ARRAY_AGG(DISTINCT repo_full_name) as repos,
      COUNT(DISTINCT repo_full_name) as repo_count
    FROM audit_tasks
    WHERE status = 'queued'
      AND created_at > NOW() - INTERVAL '14 days'
    GROUP BY category, priority
    HAVING COUNT(DISTINCT repo_full_name) >= $1
    ORDER BY repo_count DESC
    LIMIT 10
  `, [PATTERN_THRESHOLD()]);
    for (const row of taskPatterns.rows) {
        await (0, portfolioDb_1.upsertPattern)({
            patternType: 'improvement',
            patternKey: `task:${row.category}:${row.priority}`,
            description: `${row.priority} ${row.category} improvement needed across portfolio`,
            affectedRepos: row.repos,
            severity: row.priority === 'critical' ? 'high' : 'medium',
        });
        detected.push({ type: 'task', repos: row.repos,
            description: `${row.priority} ${row.category}` });
    }
    const notable = detected.filter((d) => d.repos.length >= PATTERN_THRESHOLD());
    if (notable.length > 0) {
        const lines = notable.slice(0, 3).map((p) => `· ${p.description} (${p.repos.length} repos: ${p.repos.map((r) => r.split('/')[1]).join(', ')})`).join('\n');
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)(`Project Sentinel — Portfolio Patterns Detected 🔍\n\n${lines}\n\nThese issues affect multiple repos. Consider a batch fix.`, null, null), { label: 'patternDetector' });
    }
    logger_1.default.info({ detected: detected.length }, 'Pattern detection complete');
    return detected;
}
module.exports = { detectPatterns };
//# sourceMappingURL=patternDetector.js.map