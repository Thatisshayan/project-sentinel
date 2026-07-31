// Real row shape for audit_tasks (see auditDb.ts's schema init for the DDL).
// Standalone module because auditDb.ts uses `export =`.

export interface AuditTaskRow {
  id: number;
  audit_cycle_id: number;
  repo_full_name: string;
  task_number: number;
  title: string;
  description: string | null;
  priority: string;
  category: string | null;
  affected_files: string[] | null;
  complexity: string;
  safe_to_auto_execute: boolean;
  safety_reason: string | null;
  acceptance_criteria: string | null;
  status: string;
  batch_number: number | null;
  builder_agent: string | null;
  notion_page_id: string | null;
  branch_name: string | null;
  commit_sha: string | null;
  commit_url: string | null;
  pr_url: string | null;
  pr_number: number | null;
  failure_reason: string | null;
  retry_count: number;
  source: string;
  created_at: string;
}
