// Real row shapes for the agent_registry / agent_messages tables (see
// agentDb.ts's initAgentSchema for the DDL). Kept in a standalone types
// module because agentDb.ts uses `export =`, which TypeScript disallows
// mixing with additional `export` statements in the same file.

export interface AgentRow {
  id: number;
  agent_id: string;
  agent_label: string;
  repo_full_name: string | null;
  task_type: string | null;
  task_id: number | null;
  task_title: string | null;
  status: string;
  started_at: string | null;
  last_active_at: string;
  completed_tasks: number;
  failed_tasks: number;
}

export interface AgentMessageRow {
  id: number;
  agent_id: string;
  agent_label: string;
  message: string;
  message_type: string;
  repo_name: string | null;
  created_at: string;
}
