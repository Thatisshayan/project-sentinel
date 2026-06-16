const BASE = process.env.SENTINEL_API_URL ?? '';
const KEY  = process.env.SENTINEL_UI_KEY ?? '';

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(KEY ? { 'x-sentinel-key': KEY } : {}),
      ...(opts?.headers ?? {}),
    },
    next: { revalidate: 30 },
  });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RepoMetric {
  repo_name: string;
  repo_full_name: string;
  health_score: number;
  build_status: 'pass' | 'fail' | 'pending' | null;
  priority: string;
  builds_passed: number;
  builds_failed: number;
  tasks_done: number;
  tasks_queued: number;
  last_commit_at: string | null;
  last_build_at: string | null;
  recorded_at: string;
  security_score: number;
}

export interface AgentRow {
  agent_id: string;
  agent_label: string;
  repo_full_name: string | null;
  task_id: number | null;
  task_title: string | null;
  status: 'idle' | 'working' | 'paused' | 'failed';
  started_at: string | null;
  last_active_at: string;
  completed_tasks: number;
  failed_tasks: number;
}

export interface AuditTask {
  id: number;
  audit_cycle_id: number;
  repo_full_name: string;
  task_number: number;
  title: string;
  description: string;
  priority: string;
  category: string;
  complexity: string;
  status: string;
  safe_to_auto_execute: boolean;
}

export interface AgentMessage {
  id: number;
  agent_id: string;
  agent_label: string;
  message: string;
  message_type: string;
  repo_name: string | null;
  created_at: string;
}

export interface Sprint {
  id: number;
  week_start: string;
  week_end: string;
  total_tasks: number;
  estimated_cost: number;
  health_start: number;
  proposal_summary: string;
  status: string;
  approved_at: string | null;
}

export interface SprintTask {
  id: number;
  sprint_id: number;
  repo_name: string;
  task_title: string;
  priority: string;
  complexity: string;
  builder_agent: string;
  estimated_cost: number;
  execution_order: number;
  status: string;
}

export interface VelocityMetric {
  week_start: string;
  tasks_completed: number;
  prs_merged: number;
  builds_fixed: number;
  avg_health: number;
  health_delta: number;
  api_cost: number;
}

export interface SecurityScore {
  repo_name: string;
  score: number;
  vulnerabilities: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  recorded_date: string;
}

export interface SecurityIssue {
  id: number;
  repo_full_name: string;
  issue_type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  status: string;
  cve_id?: string;
  cvss_score?: number;
  created_at: string;
}

export interface PortfolioData {
  repos: RepoMetric[];
  agents: AgentRow[];
  monthlyCost: number;
  tasksQueued: number;
  healthDelta: number | null;
}

// ── Fetchers ──────────────────────────────────────────────────────────────────

export const getPortfolio = () => api<PortfolioData>('/portfolio');

export const getAgents = () => api<AgentRow[]>('/agents');

export const getAgentRoomMessages = (limit = 50) =>
  api<AgentMessage[]>(`/agent-room/messages?limit=${limit}`);

export const getCurrentSprint = () =>
  api<{ sprint: Sprint; tasks: SprintTask[]; velocity: VelocityMetric[] } | null>(
    '/sprints/current'
  );

export const getSecurityPortfolio = () =>
  api<{ scores: SecurityScore[]; issues: SecurityIssue[] }>('/security/portfolio');

export const getCosts = () =>
  api<{ monthly: number; byRepo: { repo_full_name: string; cost: number }[] }>('/costs');

export const getRepoDetail = (name: string) =>
  api<RepoMetric & { tasks: AuditTask[]; lastCycle: object | null }>(`/repo/${name}`);

export interface ConnectorStatus {
  name: string;
  status: 'connected' | 'error' | 'unconfigured';
  detail: string | null;
}

export const getIntegrationsStatus = () =>
  api<{ connectors: ConnectorStatus[] }>('/integrations/status');

// ── Actions ───────────────────────────────────────────────────────────────────

export const approveSprint = (sprintId: number) =>
  api('/sprint/approve', { method: 'POST', body: JSON.stringify({ sprintId }), next: undefined });

export const skipSprint = (sprintId: number) =>
  api('/sprint/skip', { method: 'POST', body: JSON.stringify({ sprintId }), next: undefined });

export const auditRepo = (name: string) =>
  api(`/repo/${name}/audit`, { method: 'POST', next: undefined });

export const toggleAgent = (id: string) =>
  api(`/agents/${id}/toggle`, { method: 'POST', next: undefined });

export const pauseAll = () =>
  api('/system/pause', { method: 'POST', next: undefined });

export const resumeAll = () =>
  api('/system/resume', { method: 'POST', next: undefined });
