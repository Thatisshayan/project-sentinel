const logger = require('./logger');

let settingsCache = null;
let cacheTime = 0;
const CACHE_DURATION = 60000; // 60 seconds

async function loadSettings(forceRefresh = false) {
  if (!forceRefresh && settingsCache && Date.now() - cacheTime < CACHE_DURATION) {
    return settingsCache;
  }

  try {
    const { getSettings } = require('./settingsDb');
    settingsCache = await getSettings();
    cacheTime = Date.now();
  } catch (err) {
    logger.warn({ err: err.message }, 'Failed to load settings from DB, using env fallbacks');
    settingsCache = getEnvFallbacks();
  }

  return settingsCache;
}

function getEnvFallbacks() {
  return {
    auto_approve_tasks: process.env.AUTO_APPROVE_TASKS === 'true',
    audit_cooldown_h: parseInt(process.env.AUDIT_COOLDOWN_HOURS || '12'),
    max_active_agents: parseInt(process.env.MAX_ACTIVE_AGENTS || '4'),
    daily_report_time: process.env.DAILY_REPORT_TIME || '07:00:00',
    primary_agent: process.env.PRIMARY_AGENT || 'nvidia',
    build_agent: process.env.BUILD_AGENT || 'qwen_coder',
    fallback_agent: process.env.FALLBACK_AGENT || 'gemini',
    telegram_alerts: process.env.TELEGRAM_ALERTS !== 'false',
    email_digest: process.env.EMAIL_DIGEST === 'true',
  };
}

module.exports = {
  loadSettings,
  getEnvFallbacks,
};
