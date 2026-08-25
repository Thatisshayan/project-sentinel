const BASE = process.env.SENTINEL_API_URL ?? '';
const KEY  = process.env.SENTINEL_UI_KEY ?? '';

// Hard timeout so a slow/unreachable backend fails fast (F1 from UI E2E report:
// a hung connection previously blocked the whole server-component render forever).
const API_TIMEOUT_MS = 8000;

export class ApiTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(path: string, timeoutMs: number, cause?: unknown) {
    super(`API ${path} timed out after ${timeoutMs}ms`, { cause });
    this.name = 'ApiTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export class ApiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiConfigError';
  }
}

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  if (!BASE) {
    throw new ApiConfigError(`SENTINEL_API_URL is not configured (cannot reach /api${path})`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/api${path}`, {
      // `cache: 'no-store'` unconditionally, not a `next.revalidate` window:
      // every one of these fetchers backs a view with a mutate-then-
      // router.refresh() action (repo memory add/delete, agent toggle,
      // sprint approve/skip, security patch, repo audit). A cached fetch
      // means router.refresh() re-invokes the Server Component but still
      // serves the pre-mutation response until the cache window lapses, so
      // a just-added memory entry (for example) silently doesn't appear.
      // This also used to be placed after `...opts`, clobbering any
      // per-call override the caller passed in — no-store is the right
      // default so there's nothing left to override.
      ...opts,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(KEY ? { 'x-sentinel-key': KEY } : {}),
        ...(opts?.headers ?? {}),
      },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
    return res.json() as Promise<T>;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiTimeoutError(path, API_TIMEOUT_MS, err);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RepoMetric {
  repo_name: string;
  repo_full_name: string;
  health_score: number;
  build_status: string | null;
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
  audit_task_id: number | null;
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

export interface GovernanceStatus {
  repoFullName: string;
  branch: string;
  status: 'healthy' | 'drift' | 'unconfigured';
  branchProtectionConfigured: boolean;
  enforceAdmins: boolean | null;
  requirePullRequestReviews: boolean | null;
  dismissStaleReviews: boolean | null;
  requireUpToDateBranches: boolean | null;
  allowForcePushes: boolean | null;
  allowDeletions: boolean | null;
  requiredStatusChecks: string[];
  missingRequiredChecks: string[];
  drift: string[];
}

// ── Fetchers ──────────────────────────────────────────────────────────────────

export const getPortfolio = () => api<PortfolioData>('/portfolio');
export const getGovernanceStatus = () => api<GovernanceStatus>('/governance/status');

export const getAgents = () => api<AgentRow[]>('/agents');

export const getAgentRoomMessages = (limit = 50) =>
  api<AgentMessage[]>(`/agent-room/messages?limit=${limit}`);

export const getCurrentSprint = () =>
  api<{ sprint: Sprint; tasks: SprintTask[]; velocity: VelocityMetric[] } | null>(
    '/sprints/current'
  );

export const getSecurityPortfolio = () =>
  api<{ scores: SecurityScore[]; issues: SecurityIssue[] }>('/security/portfolio');

export interface RepoAspectState {
  aspect: string;
  sprintCount: number;
}

export interface RepoAutomationPolicy {
  allowTaskExecution: boolean;
  allowPrOpen: boolean;
  allowPrUpdate: boolean;
  allowAutoPush: boolean;
}

export type RepoAutomationPreset =
  | 'audit-only'
  | 'propose-only'
  | 'execute-no-push'
  | 'full-auto'
  | 'custom';

export interface RepoPolicyAuditEntry {
  id: number;
  repoName: string;
  changedBy: string;
  presetBefore: RepoAutomationPreset;
  presetAfter: RepoAutomationPreset;
  policyBefore: RepoAutomationPolicy;
  policyAfter: RepoAutomationPolicy;
  changedAt: string;
}

export interface RepoAutomationPolicyState {
  preset: RepoAutomationPreset;
  policy: RepoAutomationPolicy;
}

export const getRepoDetail = (name: string) =>
  api<RepoMetric & { tasks: AuditTask[]; lastCycle: object | null; aspect: RepoAspectState | null; policy: RepoAutomationPolicyState; policyAuditLog: RepoPolicyAuditEntry[] }>(`/repo/${name}`);

export type ProjectMemoryType = 'dismissed_finding' | 'convention' | 'decision' | 'note';

export interface ProjectMemoryEntry {
  id: number;
  repo_full_name: string;
  type: ProjectMemoryType;
  content: string;
  added_by: string | null;
  created_at: string;
}

export const getRepoMemory = (name: string) =>
  api<ProjectMemoryEntry[]>(`/repo/${name}/memory`);

export interface ConnectorStatus {
  name: string;
  status: 'connected' | 'error' | 'unconfigured';
  detail: string | null;
}

export const getIntegrationsStatus = () =>
  api<{ connectors: ConnectorStatus[] }>('/integrations/status');

