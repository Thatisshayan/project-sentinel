// Real row shape for portfolio_metrics (see portfolioDb.ts's
// initPortfolioSchema for the DDL). Standalone module for the same reason
// as types/agentRow.ts: portfolioDb.ts uses `export =`.

export interface PortfolioMetricRow {
  id: number;
  repo_full_name: string;
  repo_name: string;
  health_score: string | null;
  build_status: string | null;
  priority: string;
  builds_passed: number;
  builds_failed: number;
  tasks_done: number;
  tasks_queued: number;
  debugger_runs: number;
  last_commit_at: string | null;
  last_build_at: string | null;
  recorded_at: string;
}
