// Real row shape for debug_attempts (see dbClient.ts's schema init for the
// DDL). Standalone module because dbClient.ts uses `export =`.

export interface DebugAttemptRow {
  id: number;
  repo_full_name: string;
  commit_sha: string;
  attempt_number: number;
  max_attempts: number;
  status: string;
  debugger_used: string | null;
  fix_commit_sha: string | null;
  fix_commit_url: string | null;
  fix_branch: string | null;
  fix_pr_url: string | null;
  failure_reason: string | null;
  build_provider: string | null;
  build_url: string | null;
  high_risk: boolean;
  high_risk_reason: string | null;
  created_at: string;
  updated_at: string;
}
