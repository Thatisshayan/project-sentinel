// Real row shapes for self_audit_cycles / model_performance /
// component_health (see selfAuditDb.ts's schema init for the DDL).
// Standalone module because selfAuditDb.ts uses `export =`.

export interface ModelScoreRow {
  model_id: string;
  total: string;
  successes: string;
  success_rate: string;
  avg_duration_ms: string | null;
}

export interface ComponentHealthRow {
  id: number;
  component_name: string;
  failure_count: number;
  last_failure_at: string | null;
  last_error: string | null;
  healing_task_id: number | null;
  status: string;
  updated_at: string;
}

export interface SelfAuditCycleRow {
  id: number;
  status: string;
  health_score: string | null;
  audit_summary: string | null;
  tasks_generated: number;
  tasks_approved: number;
  tasks_completed: number;
  triggered_at: string;
  completed_at: string | null;
}
