import logger from './logger';
import { getDegradedComponents, recordComponentFailure, recordComponentSuccess } from './selfAuditDb';
import { sendTelegramMessage } from './telegramClient';

async function checkAndHeal(): Promise<void> {
  const degraded = await getDegradedComponents();
  if (degraded.length === 0) return;

  logger.warn({ count: degraded.length }, 'Degraded components detected');

  const lines = degraded.map((c: any) =>
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

async function reportFailure(componentName: string, error: any): Promise<void> {
  await recordComponentFailure(componentName, error?.message || String(error)).catch(() => {});
  await checkAndHeal().catch(() => {});
}

async function reportSuccess(componentName: string): Promise<void> {
  await recordComponentSuccess(componentName).catch(() => {});
}

export = { reportFailure, reportSuccess, checkAndHeal };
