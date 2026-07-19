import { safeFire, fireAndForget } from './utils/safeFire';
import logger from './logger';
import { getDegradedComponents, recordComponentFailure, recordComponentSuccess, tryClaimSelfHealerAlert } from './selfAuditDb';
import { sendTelegramMessage } from './telegramClient';

const ALERT_COOLDOWN_MS = 5 * 60 * 1000;

async function checkAndHeal(): Promise<void> {
  const degraded = await getDegradedComponents();
  if (degraded.length === 0) return;

  logger.warn({ count: degraded.length }, 'Degraded components detected');

  const shouldAlert = await tryClaimSelfHealerAlert(ALERT_COOLDOWN_MS);
  if (!shouldAlert) return;

  const lines = degraded.map((c: any) =>
    `· ${c.component_name}: ${c.failure_count} failures — ${(c.last_error || '').substring(0, 80)}`
  ).join('\n');

  await safeFire(sendTelegramMessage([
    `🛡️ Sentinel Self-Healing Alert ⚠️`,
    ``,
    `${degraded.length} component(s) degraded:`,
    lines,
    ``,
    `These components are failing repeatedly.`,
    `Sentinel has generated fix tasks — review in Notion.`,
    ``,
    `/sentinel self-approve — approve fix execution`,
  ].join('\n'), null, null), { label: 'selfHealer' })
}

async function reportFailure(componentName: string, error: any): Promise<void> {
  await safeFire(recordComponentFailure(componentName, error?.message || String(error)), { label: 'selfHealer' })
  await safeFire(checkAndHeal(), { label: 'selfHealer' })
}

async function reportSuccess(componentName: string): Promise<void> {
  await safeFire(recordComponentSuccess(componentName), { label: 'selfHealer' })
}

export = { reportFailure, reportSuccess, checkAndHeal };
