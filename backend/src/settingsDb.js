const { query } = require('./dbClient');
const logger    = require('./logger');

async function initSettingsSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      id                  SERIAL PRIMARY KEY,
      auto_approve_tasks  BOOLEAN DEFAULT false,
      audit_cooldown_h    INTEGER DEFAULT 12,
      max_active_agents   INTEGER DEFAULT 4,
      daily_report_time   TIME DEFAULT '07:00:00',
      primary_agent       TEXT DEFAULT 'nvidia',
      build_agent         TEXT DEFAULT 'qwen_coder',
      fallback_agent      TEXT DEFAULT 'gemini',
      telegram_alerts     BOOLEAN DEFAULT true,
      email_digest        BOOLEAN DEFAULT false,
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Ensure only one row exists (singleton pattern)
  const existing = await query(`SELECT COUNT(*) as cnt FROM system_settings`);
  if (parseInt(existing.rows[0].cnt, 10) === 0) {
    await query(`
      INSERT INTO system_settings DEFAULT VALUES
    `);
    logger.info('System settings table initialized with defaults');
  }
}

async function getSettings() {
  const r = await query(`
    SELECT
      auto_approve_tasks,
      audit_cooldown_h,
      max_active_agents,
      daily_report_time,
      primary_agent,
      build_agent,
      fallback_agent,
      telegram_alerts,
      email_digest,
      updated_at
    FROM system_settings
    LIMIT 1
  `);

  if (!r.rows[0]) {
    // Fallback to defaults if query somehow returns nothing
    return {
      auto_approve_tasks: false,
      audit_cooldown_h: 12,
      max_active_agents: 4,
      daily_report_time: '07:00:00',
      primary_agent: 'nvidia',
      build_agent: 'qwen_coder',
      fallback_agent: 'gemini',
      telegram_alerts: true,
      email_digest: false,
      updated_at: new Date().toISOString(),
    };
  }

  return r.rows[0];
}

async function updateSettings(updates) {
  const allowed = [
    'auto_approve_tasks',
    'audit_cooldown_h',
    'max_active_agents',
    'daily_report_time',
    'primary_agent',
    'build_agent',
    'fallback_agent',
    'telegram_alerts',
    'email_digest',
  ];

  // Build dynamic SET clause
  const setClauses = [];
  const values = [];
  let paramIndex = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (!allowed.includes(key)) continue;
    setClauses.push(`${key} = $${paramIndex}`);
    values.push(value);
    paramIndex++;
  }

  if (setClauses.length === 0) {
    return await getSettings();
  }

  setClauses.push(`updated_at = NOW()`);

  const sql = `
    UPDATE system_settings
    SET ${setClauses.join(', ')}
    WHERE id = 1
    RETURNING *
  `;

  const r = await query(sql, values);
  logger.info({ updated: Object.keys(updates) }, 'Settings updated');
  return r.rows[0] || await getSettings();
}

module.exports = {
  initSettingsSchema,
  getSettings,
  updateSettings,
};
