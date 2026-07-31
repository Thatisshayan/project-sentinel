import logger from './logger';
import { getSettings, updateSettings as updateSettingsDb } from './settingsDb';
import type { Settings } from './types/settings';

let settingsCache: Settings | null = null;
let cacheTime = 0;
const CACHE_DURATION = 60000; // 60 seconds

async function loadSettings(forceRefresh = false): Promise<Settings> {
  if (!forceRefresh && settingsCache && Date.now() - cacheTime < CACHE_DURATION) {
    return settingsCache;
  }

  try {
    settingsCache = await getSettings();
    cacheTime = Date.now();
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Failed to load settings from DB, using env fallbacks');
    settingsCache = getEnvFallbacks();
    cacheTime = Date.now();
  }

  return settingsCache;
}

function getEnvFallbacks(): Settings {
  return {
    auto_approve_tasks: process.env['AUTO_APPROVE_TASKS'] === 'true',
    audit_cooldown_h: parseInt(process.env['AUDIT_COOLDOWN_HOURS'] || '12'),
    max_active_agents: parseInt(process.env['MAX_ACTIVE_AGENTS'] || '4'),
    daily_report_time: process.env['DAILY_REPORT_TIME'] || '07:00:00',
    primary_agent: process.env['PRIMARY_AGENT'] || 'nvidia',
    build_agent: process.env['BUILD_AGENT'] || 'nvidia',
    fallback_agent: process.env['FALLBACK_AGENT'] || 'gemini',
    telegram_alerts: process.env['TELEGRAM_ALERTS'] !== 'false',
    email_digest: process.env['EMAIL_DIGEST'] === 'true',
    batch_size_override: null,
    daily_limit_override: null,
    sentinel_paused: false,
    updated_at: new Date().toISOString(),
  };
}

async function updateSettings(updates: Record<string, unknown>): Promise<void> {
  try {
    await updateSettingsDb(updates);
    settingsCache = null; // invalidate cache
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Failed to save settings to DB');
  }
}

export = {
  loadSettings,
  getEnvFallbacks,
  updateSettings,
};
