const logger = require('./logger');
const { getDegradedComponents,
        recordComponentFailure,
        recordComponentSuccess } = require('./selfAuditDb');
const { sendTelegramMessage }    = require('./telegramClient');

async function checkAndHeal() {
  const degraded = await getDegradedComponents();
  if (degraded.length === 0) return;

  logger.warn({ count: degraded.length }, 'Degraded components detected');

  const lines = degraded.map(c =>
    `· ${c.component_name}: ${c.failure_count} failures — ${(c.last_error || '').substring(0, 80)}`
  ).join('\n');

  await sendTelegramMessage([
    `🛡️ Sentinel Self-Healing Alert ⚠️`,
    ``,
    `${degraded.length} component(s) degraded:`,
    lines,
    ``,
    `These components are failing repeatedly.`,
    `Sentinel has generated fix tasks — review in Notion.`,
    ``,
    `/sentinel self-approve — approve fix execution`,
  ].join('\n'), null, null).catch(() => {});
}

async function reportFailure(componentName, error) {
  await recordComponentFailure(componentName, error?.message || String(error)).catch(() => {});
  await checkAndHeal().catch(() => {});
}

async function reportSuccess(componentName) {
  await recordComponentSuccess(componentName).catch(() => {});
}

module.exports = { reportFailure, reportSuccess, checkAndHeal };
