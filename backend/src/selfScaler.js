const logger = require('./logger');
const { getCapacityStatus }  = require('./capacityManager');
const { sendTelegramMessage } = require('./telegramClient');
const { query }              = require('./dbClient');

// In-memory overrides — these shadow the env vars for the running process.
// A Railway redeploy resets them, which is fine (budget resets monthly).
let BATCH_SIZE_OVERRIDE   = null;
let DAILY_LIMIT_OVERRIDE  = null;

function getEffectiveBatchSize() {
  return BATCH_SIZE_OVERRIDE ?? parseInt(process.env.TASK_BATCH_SIZE || '5');
}

function getEffectiveDailyLimit() {
  return DAILY_LIMIT_OVERRIDE ?? parseInt(process.env.MAX_BUILDER_TASKS_PER_DAY || '10');
}

async function runSelfScaler() {
  try {
    const [capacity, queueResult] = await Promise.all([
      getCapacityStatus(),
      query(`SELECT COUNT(*) as c FROM audit_tasks WHERE status = 'queued' AND safe_to_auto_execute = true`)
        .catch(() => ({ rows: [{ c: 0 }] })),
    ]);

    const usagePct  = capacity.usagePercent || 0;
    const queuedSafe = parseInt(queueResult.rows[0]?.c || 0);
    const decisions  = [];

    // Rule 1: Budget > 85% → cut batch size and daily limit
    if (usagePct >= 85) {
      const newBatch = Math.max(2, Math.floor(getEffectiveBatchSize() * 0.6));
      const newDaily = Math.max(3, Math.floor(getEffectiveDailyLimit() * 0.5));
      if (BATCH_SIZE_OVERRIDE !== newBatch || DAILY_LIMIT_OVERRIDE !== newDaily) {
        BATCH_SIZE_OVERRIDE  = newBatch;
        DAILY_LIMIT_OVERRIDE = newDaily;
        decisions.push(`Budget at ${usagePct}% → batch size→${newBatch}, daily limit→${newDaily}`);
      }
    }
    // Rule 2: Budget < 50% and queue is large → scale up
    else if (usagePct < 50 && queuedSafe > 20) {
      const newBatch = Math.min(8, getEffectiveBatchSize() + 1);
      const newDaily = Math.min(20, getEffectiveDailyLimit() + 3);
      if (BATCH_SIZE_OVERRIDE !== newBatch || DAILY_LIMIT_OVERRIDE !== newDaily) {
        BATCH_SIZE_OVERRIDE  = newBatch;
        DAILY_LIMIT_OVERRIDE = newDaily;
        decisions.push(`Budget healthy (${usagePct}%), ${queuedSafe} tasks queued → batch size→${newBatch}, daily limit→${newDaily}`);
      }
    }
    // Rule 3: Budget < 20% → stop auto-execution entirely
    else if (usagePct >= 95) {
      if (DAILY_LIMIT_OVERRIDE !== 0) {
        DAILY_LIMIT_OVERRIDE = 0;
        decisions.push(`Budget at ${usagePct}% (critical) → auto-execution paused until next month`);
      }
    }
    // Rule 4: Normal range → restore defaults
    else if (usagePct < 75 && (BATCH_SIZE_OVERRIDE !== null || DAILY_LIMIT_OVERRIDE !== null)) {
      BATCH_SIZE_OVERRIDE  = null;
      DAILY_LIMIT_OVERRIDE = null;
      decisions.push(`Budget normalized at ${usagePct}% → restoring default limits`);
    }

    if (decisions.length > 0) {
      logger.info({ decisions, usagePct, queuedSafe }, 'Self-scaler adjusted limits');
      await sendTelegramMessage(
        `Project Sentinel — Auto-Scaled\n\n${decisions.join('\n')}\n\n` +
        `Budget: $${capacity.monthlySpend.toFixed(2)}/$${capacity.monthlyBudget} (${usagePct}%)\n` +
        `Queued tasks: ${queuedSafe}`,
        null, null
      ).catch(() => {});
    } else {
      logger.info({ usagePct, queuedSafe, batch: getEffectiveBatchSize(), daily: getEffectiveDailyLimit() }, 'Self-scaler: no changes needed');
    }

    return { usagePct, queuedSafe, batchSize: getEffectiveBatchSize(), dailyLimit: getEffectiveDailyLimit() };
  } catch (err) {
    logger.warn({ err: err.message }, 'Self-scaler failed — non-blocking');
    return null;
  }
}

module.exports = { runSelfScaler, getEffectiveBatchSize, getEffectiveDailyLimit };
