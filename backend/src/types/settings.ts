// Shape of the singleton system_settings row (see settingsDb.ts's
// initSettingsSchema for the DDL). Standalone module because settingsDb.ts
// uses `export =`.

export interface Settings {
  auto_approve_tasks: boolean;
  audit_cooldown_h: number;
  max_active_agents: number;
  daily_report_time: string;
  primary_agent: string;
  build_agent: string;
  fallback_agent: string;
  telegram_alerts: boolean;
  email_digest: boolean;
  batch_size_override: number | null;
  daily_limit_override: number | null;
  sentinel_paused: boolean;
  updated_at: string;
}
