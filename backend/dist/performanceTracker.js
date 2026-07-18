"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const safeFire_1 = require("./utils/safeFire");
const selfAuditDb_1 = require("./selfAuditDb");
const logger_1 = __importDefault(require("./logger"));
async function trackModelCall(modelId, taskType, complexity, fn) {
    const start = Date.now();
    let success = false;
    try {
        const result = await fn();
        success = true;
        return result;
    }
    catch (err) {
        success = false;
        throw err;
    }
    finally {
        const durationMs = Date.now() - start;
        (0, safeFire_1.fireAndForget)((0, selfAuditDb_1.recordModelOutcome)({ modelId, taskType, complexity, success, durationMs }), { label: 'performanceTracker' });
        logger_1.default.debug({ modelId, taskType, success, durationMs }, 'Model outcome recorded');
    }
}
async function getRecommendedModel(taskType, fallback = 'nvidia') {
    try {
        const best = await (0, selfAuditDb_1.getBestModelForTask)(taskType);
        if (best) {
            logger_1.default.debug({ taskType, best }, 'Using data-backed model recommendation');
            return best;
        }
    }
    catch (err) {
        logger_1.default.warn({ err: err.message }, 'Could not get model recommendation');
    }
    return fallback;
}
async function getPerformanceReport() {
    const taskTypes = ['audit', 'build_low', 'build_medium', 'build_high', 'debug'];
    const report = [];
    for (const taskType of taskTypes) {
        const scores = await (0, selfAuditDb_1.getModelScores)(taskType).catch(() => []);
        if (scores.length === 0)
            continue;
        report.push(`\n${taskType.toUpperCase()}:`);
        scores.forEach((s) => {
            report.push(`  ${s.model_id}: ${s.success_rate}% success (${s.total} samples, avg ${Math.round(s.avg_duration_ms / 1000)}s)`);
        });
    }
    return report.length > 0
        ? `📊 Model Performance Report\n${report.join('\n')}`
        : 'No performance data yet — needs 3+ samples per model per task type.';
}
module.exports = { trackModelCall, getRecommendedModel, getPerformanceReport };
//# sourceMappingURL=performanceTracker.js.map