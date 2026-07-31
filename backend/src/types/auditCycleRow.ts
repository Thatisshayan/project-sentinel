// Real row shape for audit_cycles (see auditDb.ts's schema init/ALTER
// TABLE statements for the DDL). Standalone module because auditDb.ts
// uses `export =`.

export interface AuditCycleRow {
  id: number;
  repo_full_name: string;
  commit_sha: string;
  project_name: string | null;
  status: string;
  health_score: number | null;
  audit_summary: string | null;
  audit_agent: string | null;
  tasks_total: number;
  tasks_safe: number;
  tasks_done: number;
  tasks_failed: number;
  approval_sent_at: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  aspect: string | null;
  aspect_health_score: number | null;
  aspect_effect_summary: string | null;
}
