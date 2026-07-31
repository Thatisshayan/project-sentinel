// Real row shape for portfolio_metrics (see portfolioDb.ts's
// initPortfolioSchema for the DDL). Standalone module for the same reason
// as types/agentRow.ts: portfolioDb.ts uses `export =`.

export interface RepoCostRow {
  repo_full_name: string;
  total: string;
  operations: string;
}

export interface RepoPatternRow {
  id: number;
  pattern_type: string;
  pattern_key: string;
  description: string | null;
  affected_repos: string[] | null;
  severity: string;
  status: string;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
}

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

// portfolioAnalytics.ts's getPortfolioSummary() return shape — lives here
// (rather than in portfolioAnalytics.ts) so dailyReport.ts and other
// consumers can import it without pulling in the analytics module itself.
export interface PortfolioSummary {
  metrics: PortfolioMetricRow[];
  healthy: PortfolioMetricRow[];
  broken: PortfolioMetricRow[];
  unknown: PortfolioMetricRow[];
  avgHealth: string;
  dailyCost: number;
  monthlyCost: number;
  totalRepos: number;
}
