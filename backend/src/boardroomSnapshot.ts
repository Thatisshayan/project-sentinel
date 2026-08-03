import { getAllLatestMetrics } from './portfolioDb';
import { getCapacityStatus } from './capacityManager';
import { getAllAgents } from './agentDb';
import { query } from './dbClient';
import type { CapacityStatus } from './types/capacityStatus';
import type { PortfolioMetricRow } from './types/portfolioRow';

export interface BoardroomSnapshot {
  updatedAt: string;
  summary: string;
  boardDecision: string;
  health: number;
  state: {
    branch: string;
    upstream: string;
    dirtyTree: string;
    build: string;
    test: string;
    scripts: string;
    load: string;
    queueDepth: string;
    agentsActive: string;
    eventRate: string;
    uptime: string;
    buildPct: string;
    testPct: string;
    coveragePct: string;
    mttr: string;
  };
  kpis: Array<[string, string]>;
  projects: Array<{
    name: string;
    sub: string;
    status: string[];
    tone: 'good' | 'warn' | 'bad';
  }>;
  risks: Array<[string, string, string]>;
  actions: Array<[string, string, string]>;
  ledger: Array<[string, string, string, string, string, string]>;
  milestones: Array<[string, string, string]>;
}

async function getQueuedCount(): Promise<number> {
  const result = await query(`SELECT COUNT(*) as c FROM audit_tasks WHERE status = 'queued' AND safe_to_auto_execute = true`).catch(() => ({ rows: [{ c: '0' }] }));
  return Number(result.rows[0]?.c || 0);
}

function pickHealth(metrics: PortfolioMetricRow[]): number {
  if (metrics.length === 0) return 0;
  const total = metrics.reduce((sum, metric) => sum + parseFloat(metric.health_score || '0'), 0);
  return Math.round((total / metrics.length) * 10) / 10;
}

function summarizeProjects(metrics: PortfolioMetricRow[]): BoardroomSnapshot['projects'] {
  return [...metrics]
    .sort((a, b) => parseFloat(b.health_score || '0') - parseFloat(a.health_score || '0'))
    .slice(0, 5)
    .map((metric) => {
      const status = metric.build_status === 'failed'
        ? ['Build failing', 'Needs attention', `${metric.tasks_queued || 0} queued tasks`]
        : metric.tasks_queued > 0
          ? ['Execution active', 'Queued work', `${metric.tasks_queued} tasks queued`]
          : ['Stable', 'Board green', 'No queued work'];
      return {
        name: metric.repo_name,
        sub: `${metric.priority || 'medium'} priority · ${metric.build_status || 'unknown'} build`,
        status,
        tone: metric.build_status === 'failed' ? 'bad' : metric.tasks_queued > 0 ? 'warn' : 'good',
      };
    });
}

export async function buildBoardroomSnapshot(): Promise<BoardroomSnapshot> {
  const [metrics, capacity, activeAgents, queuedCount] = await Promise.all([
    getAllLatestMetrics().catch(() => [] as PortfolioMetricRow[]),
    getCapacityStatus().catch(() => ({} as Partial<CapacityStatus>)),
    getAllAgents().catch(() => []),
    getQueuedCount(),
  ]);

  const health = pickHealth(metrics);
  const brokenRepos = metrics.filter((m) => m.build_status === 'failed').map((m) => m.repo_name);
  const working = activeAgents.filter((a) => a.status === 'working');
  const avgHealth = metrics.length ? health.toFixed(1) : 'N/A';
  const now = new Date().toISOString();

  return {
    updatedAt: now,
    summary: 'Boardroom is the canonical governance surface. Sentinel keeps the audit picture current and can feed the same snapshot back into Boardroom.',
    boardDecision: 'Use Sentinel as the live execution and audit feeder for Boardroom',
    health,
    state: {
      branch: 'main',
      upstream: 'tracked',
      dirtyTree: 'unknown',
      build: 'not run',
      test: 'not run',
      scripts: 'report, dashboard, audit, execute',
      load: 'agent-led',
      queueDepth: String(queuedCount),
      agentsActive: `${working.length}/${activeAgents.length}`,
      eventRate: 'webhooks + scheduled jobs',
      uptime: 'self-hosted',
      buildPct: 'n/a',
      testPct: 'n/a',
      coveragePct: 'n/a',
      mttr: 'n/a',
    },
    kpis: [
      ['Portfolio health', avgHealth],
      ['Queued tasks', String(queuedCount)],
      ['Active agents', `${working.length}/${activeAgents.length}`],
      ['Recommended builder', capacity.recommendedBuilder || 'nvidia'],
      ['Monthly budget', `$${Number(capacity.monthlyBudget || 30).toFixed(0)}`],
    ],
    projects: summarizeProjects(metrics),
    risks: [
      ...brokenRepos.slice(0, 3).map((repo, idx) => [`B-${String(idx + 1).padStart(2, '0')}`, `${repo} build failing`, 'High'] as [string, string, string]),
      ['R-01', 'Snapshot is still read from local Sentinel data only', 'Medium'],
      ['R-02', 'Boardroom writeback is not wired yet', 'Medium'],
    ],
    actions: [
      ['Sentinel', 'Refreshed the Boardroom snapshot', now],
      ['Sentinel', `Queued tasks: ${queuedCount}`, now],
      ['Sentinel', `Broken repos: ${brokenRepos.length}`, now],
    ],
    ledger: metrics.slice(0, 8).map((metric, idx) => [
      String(idx + 1).padStart(3, '0'),
      metric.repo_name,
      metric.priority || 'medium',
      metric.build_status || 'unknown',
      metric.repo_name,
      metric.recorded_at || '',
    ]),
    milestones: [
      ['Snapshot builder', 'done', 'One source of truth for report and dashboard'],
      ['Dashboard command', 'done', 'Uses shared snapshot data'],
      ['Notion update', 'in progress', 'Consumes the same snapshot fields'],
      ['Boardroom feed', 'next', 'Expose snapshot payload for downstream writeback'],
    ],
  };
}
