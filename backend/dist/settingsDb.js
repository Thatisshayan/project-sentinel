"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const dbClient_1 = __importDefault(require("./dbClient"));
const logger_1 = __importDefault(require("./logger"));
const { query } = dbClient_1.default;
async function initSettingsSchema() {
    await query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      id                     SERIAL PRIMARY KEY,
      auto_approve_tasks     BOOLEAN DEFAULT false,
      audit_cooldown_h       INTEGER DEFAULT 12,
      max_active_agents      INTEGER DEFAULT 4,
      daily_report_time      TIME DEFAULT '07:00:00',
      primary_agent          TEXT DEFAULT 'nvidia',
      build_agent            TEXT DEFAULT 'qwen_coder',
      fallback_agent         TEXT DEFAULT 'gemini',
      telegram_alerts        BOOLEAN DEFAULT true,
      email_digest           BOOLEAN DEFAULT false,
      batch_size_override    INTEGER,
      daily_limit_override   INTEGER,
      updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
    // Ensure only one row exists (singleton pattern)
    const existing = await query(`SELECT COUNT(*) as cnt FROM system_settings`);
    if (parseInt(existing.rows[0].cnt, 10) === 0) {
        await query(`
      INSERT INTO system_settings DEFAULT VALUES
    `);
        logger_1.default.info('System settings table initialized with defaults');
    }
}
const SETTINGS_DEFAULTS = {
    auto_approve_tasks: false,
    audit_cooldown_h: 12,
    max_active_agents: 4,
    daily_report_time: '07:00:00',
    primary_agent: 'nvidia',
    build_agent: 'qwen_coder',
    fallback_agent: 'gemini',
    telegram_alerts: true,
    email_digest: false,
    batch_size_override: null,
    daily_limit_override: null,
};
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
      batch_size_override,
      daily_limit_override,
      updated_at
    FROM system_settings
    LIMIT 1
  `);
    const row = r.rows[0];
    if (!row) {
        // Fallback to defaults if query somehow returns nothing
        return { ...SETTINGS_DEFAULTS, updated_at: new Date().toISOString() };
    }
    // Guard against individual columns being null/undefined (stale rows,
    // schema drift, or a query result that doesn't carry every column).
    const merged = { ...SETTINGS_DEFAULTS, updated_at: row.updated_at };
    for (const key of Object.keys(SETTINGS_DEFAULTS)) {
        if (row[key] !== null && row[key] !== undefined) {
            merged[key] = row[key];
        }
    }
    return merged;
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
        'batch_size_override',
        'daily_limit_override',
    ];
    // Build dynamic SET clause
    const setClauses = [];
    const values = [];
    let paramIndex = 1;
    for (const [key, value] of Object.entries(updates)) {
        if (!allowed.includes(key))
            continue;
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
    logger_1.default.info({ updated: Object.keys(updates) }, 'Settings updated');
    return r.rows[0] || await getSettings();
}
module.exports = {
    initSettingsSchema,
    getSettings,
    updateSettings,
};
//# sourceMappingURL=settingsDb.js.map