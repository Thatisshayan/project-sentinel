// Real row shapes for the security_scans / security_issues / security_scores
// tables (see securityDb.ts's initSecuritySchema for the DDL). Standalone
// module for the same reason as types/agentRow.ts: securityDb.ts uses
// `export =`, which disallows mixing with other `export` statements.

export interface SecurityScanRow {
  id: number;
  repo_full_name: string;
  commit_sha: string;
  branch_name: string | null;
  security_score: string | null;
  vulnerabilities: number;
  secrets_found: number;
  owasp_score: string | null;
  scan_duration_ms: number | null;
  status: string;
  triggered_at: string;
  completed_at: string | null;
}

export interface SecurityIssueRow {
  id: number;
  scan_id: number | null;
  repo_full_name: string;
  issue_type: string;
  severity: string;
  title: string;
  description: string | null;
  file_path: string | null;
  line_number: number | null;
  cve_id: string | null;
  cvss_score: string | null;
  fix_available: boolean;
  fix_description: string | null;
  auto_fixable: boolean;
  status: string;
  found_at: string;
  resolved_at: string | null;
  pr_url: string | null;
  branch_name: string | null;
}

export interface SecurityScoreRow {
  id: number;
  repo_name: string;
  score: string;
  vulnerabilities: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  recorded_date: string;
  recorded_at: string;
}

/**
 * getPortfolioSecuritySummary()'s DISTINCT ON projection — deliberately
 * omits `id`/`recorded_at` (not selected), unlike the full SecurityScoreRow.
 */
export interface SecurityScoreSummaryRow {
  repo_name: string;
  score: string;
  vulnerabilities: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  recorded_date: string;
}
