const { recordModelOutcome, getBestModelForTask, getModelScores } = require('./selfAuditDb');
const logger = require('./logger');

async function trackModelCall(modelId, taskType, complexity, fn) {
  const start  = Date.now();
  let success  = false;

  try {
    const result = await fn();
    success = true;
    return result;
  } catch (err) {
    success = false;
    throw err;
  } finally {
    const durationMs = Date.now() - start;
    recordModelOutcome({ modelId, taskType, complexity, success, durationMs }).catch(() => {});
    logger.debug({ modelId, taskType, success, durationMs }, 'Model outcome recorded');
  }
}

async function getRecommendedModel(taskType, fallback = 'nvidia') {
  try {
    const best = await getBestModelForTask(taskType);
    if (best) {
      logger.debug({ taskType, best }, 'Using data-backed model recommendation');
      return best;
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Could not get model recommendation');
  }
  return fallback;
}

async function getPerformanceReport() {
  const taskTypes = ['audit', 'build_low', 'build_medium', 'build_high', 'debug'];
  const report    = [];

  for (const taskType of taskTypes) {
    const scores = await getModelScores(taskType).catch(() => []);
    if (scores.length === 0) continue;

    report.push(`\n${taskType.toUpperCase()}:`);
    scores.forEach(s => {
      report.push(
        `  ${s.model_id}: ${s.success_rate}% success (${s.total} samples, avg ${Math.round(s.avg_duration_ms / 1000)}s)`
      );
    });
  }

  return report.length > 0
    ? `📊 Model Performance Report\n${report.join('\n')}`
    : 'No performance data yet — needs 3+ samples per model per task type.';
}

module.exports = { trackModelCall, getRecommendedModel, getPerformanceReport };
