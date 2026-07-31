// Real row shapes for sprints / sprint_tasks (see sprintDb.ts's schema
// init for the DDL). Standalone module because sprintDb.ts uses
// `export =`.

export interface SprintRow {
  id: number;
  week_start: string;
  week_end: string;
  status: string;
  proposed_at: string;
  approved_at: string | null;
  completed_at: string | null;
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  skipped_tasks: number;
  estimated_cost: string;
  actual_cost: string;
  health_start: string | null;
  health_end: string | null;
  proposal_summary: string | null;
  telegram_message_id: number | null;
}

export interface SprintTaskRow {
  id: number;
  sprint_id: number;
  audit_task_id: number | null;
  repo_full_name: string;
  repo_name: string;
  task_title: string;
  task_description: string | null;
  priority: string;
  complexity: string;
  builder_agent: string;
  estimated_cost: string;
  execution_order: number;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  pr_url: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

// Shape of sprintPlanner.ts's AI-generated weekly sprint proposal JSON
// (see generateSprintProposal's prompt for the source-of-truth schema).
export interface SprintProposalTask {
  repoName: string;
  repoFullName: string;
  taskTitle: string;
  taskDescription?: string;
  priority: string;
  complexity: string;
  builderAgent: string;
  estimatedCost?: number;
  reason?: string;
}

export interface SprintProposal {
  summary: string;
  weekStart: string;
  weekEnd: string;
  totalTasks: number;
  estimatedCost: number;
  tasks: SprintProposalTask[];
}

export interface VelocityMetricRow {
  id: number;
  week_start: string;
  tasks_completed: number;
  prs_merged: number;
  builds_fixed: number;
  avg_health: string | null;
  health_delta: string | null;
  api_cost: string;
  active_repos: number;
  recorded_at: string;
}
