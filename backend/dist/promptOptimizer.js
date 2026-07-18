"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const dbClient_1 = require("./dbClient");
const logger_1 = __importDefault(require("./logger"));
async function initDefaultPrompts() {
    const existing = await (0, dbClient_1.query)('SELECT COUNT(*) as count FROM prompt_versions WHERE is_active = true');
    if (parseInt(existing.rows[0]?.count || '0') > 0)
        return;
    const defaults = [
        { promptType: 'audit', content: 'DEFAULT_AUDIT_PROMPT' },
        { promptType: 'build_task', content: 'DEFAULT_BUILD_PROMPT' },
    ];
    for (const p of defaults) {
        await (0, dbClient_1.query)(`
      INSERT INTO prompt_versions (prompt_type, version, content, is_active)
      VALUES ($1, 1, $2, true)
    `, [p.promptType, p.content]);
    }
    logger_1.default.info('Default prompts initialised');
}
async function recordPromptOutcome(promptType, success) {
    await (0, dbClient_1.query)(`
    UPDATE prompt_versions SET
      sample_count     = sample_count + 1,
      avg_success_rate = COALESCE(
        (COALESCE(avg_success_rate, 0) * sample_count + $2) / (sample_count + 1),
        $2
      )
    WHERE prompt_type = $1 AND is_active = true
  `, [promptType, success ? 100 : 0]);
}
async function getPromptStats() {
    const r = await (0, dbClient_1.query)(`
    SELECT prompt_type, version, avg_success_rate, sample_count
    FROM prompt_versions
    WHERE is_active = true
    ORDER BY prompt_type
  `);
    return r.rows;
}
async function getPromptReport() {
    const stats = await getPromptStats();
    if (stats.length === 0)
        return 'No prompt data yet.';
    const lines = stats.map((p) => `· ${p.prompt_type} v${p.version}: ${parseFloat(p.avg_success_rate || 0).toFixed(1)}% success (${p.sample_count} samples)`).join('\n');
    return `📝 Prompt Performance\n\n${lines}`;
}
module.exports = { initDefaultPrompts, recordPromptOutcome, getPromptReport };
//# sourceMappingURL=promptOptimizer.js.map