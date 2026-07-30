import logger from './logger';
import { query } from './dbClient';
import { upsertRepoMetrics, getAllLatestMetrics, getDailyCost, getMonthlyCost } from './portfolioDb';
import { repoFullName as makeFullName } from './repoResolver';
import type { PortfolioMetricRow } from './types/portfolioRow';

interface RepoStats {
  buildsPassedToday: number;
  buildsFailedToday: number;
  debuggerRunsToday: number;
  tasksDoneToday: number;
  tasksQueued: number;
  lastBuildAt: string | null;
  lastCommitAt: string | null;
  healthScore: number;
  buildStatus: string;
}

interface PortfolioSummary {
  metrics: PortfolioMetricRow[];
  healthy: PortfolioMetricRow[];
  broken: PortfolioMetricRow[];
  unknown: PortfolioMetricRow[];
  avgHealth: string;
  dailyCost: number;
  monthlyCost: number;
  totalRepos: number;
}

function buildRepoList(): Array<{ repoName: string; repoFullName: string }> {
  try {
    const watched = process.env['WATCHED_REPOS'];
    const names   = watched
      ? watched.split(',').map((s: string) => s.trim()).filter(Boolean)
      : ['acc','tapcash','AlphonsoEcosystem','session-guard','costpilot',
         'shiporex','aegis','mint','agents-ops-board','founder-social-club',
         'obsidian-studio','obsidian-media'];
    return names.map((repoName: string) => ({ repoName, repoFullName: makeFullName(repoName) }));
  } catch {
    return [];
  }
}

const REPO_LIST = buildRepoList();

const DEFAULT_PRIORITIES: Record<string, string> = {
  'acc':                 'critical',
  'tapcash':             'critical',
  'AlphonsoEcosystem':   'high',
  'session-guard':       'high',
  'costpilot':           'high',
  'shiporex':            'medium',
  'aegis':               'medium',
  'mint':                'medium',
  'agents-ops-board':    'low',
  'founder-social-club': 'low',
  'obsidian-studio':     'low',
  'obsidian-media':      'low',
};

async function getRepoStats(repoFullName: string, repoName: string): Promise<RepoStats> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const pollJobs = await query(`
    SELECT COUNT(*) as total, MAX(created_at) as last_build
    FROM build_poll_jobs
    WHERE repo_full_name = $1 AND created_at > $2
  `, [repoFullName, since24h]);

  const failures = await query(`
    SELECT COUNT(*) as failed_count
    FROM debug_attempts
    WHERE repo_full_name = $1 AND created_at > $2
  `, [repoFullName, since24h]);

  const latestDebug = await query(`
    SELECT status FROM debug_attempts
    WHERE repo_full_name = $1
    ORDER BY created_at DESC LIMIT 1
  `, [repoFullName]);

  const taskStats = await query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'done')   as done,
      COUNT(*) FILTER (WHERE status = 'queued') as queued
    FROM audit_tasks
    WHERE repo_full_name = $1
  `, [repoFullName]);

  const totalBuilds  = parseInt(pollJobs.rows[0]?.total || '0');
  const failedBuilds = parseInt(failures.rows[0]?.failed_count || '0');
  const passedBuilds = Math.max(0, totalBuilds - failedBuilds);
  const latestStatus = latestDebug.rows[0]?.status || null;
  const taskDone     = parseInt(taskStats.rows[0]?.done   || 0);
  const taskQueued   = parseInt(taskStats.rows[0]?.queued || 0);

  let buildStatus = 'unknown';
  if (totalBuilds > 0) {
    buildStatus = failedBuilds === 0 ? 'passing' : 'failed';
  } else if (latestStatus === 'resolved') {
    // Debug attempt's fix PR is confirmed merged — build is actually fixed.
    buildStatus = 'passing';
  } else if (latestStatus && latestStatus !== 'stopped') {
    // Covers 'fix_pending' too: a fix PR being open isn't the same as merged —
    // the repo's main branch is still red until the merge webhook confirms it.
    buildStatus = 'failed';
  }

  const passRate = totalBuilds > 0
    ? passedBuilds / totalBuilds
    : buildStatus === 'passing' ? 1 : buildStatus === 'failed' ? 0 : 0.5;

  let healthScore = 5.0;
  healthScore += passRate * 3;
  if (taskDone   > 0) healthScore += Math.min(taskDone   * 0.2, 1.5);
  if (taskQueued > 0) healthScore -= Math.min(taskQueued * 0.1, 0.5);
  if (failedBuilds > 0) healthScore -= failedBuilds * 0.5;
  healthScore = Math.max(1, Math.min(10, healthScore));

  return {
    buildsPassedToday: passedBuilds,
    buildsFailedToday: failedBuilds,
    debuggerRunsToday: failedBuilds,
    tasksDoneToday:    taskDone,
    tasksQueued:       taskQueued,
    lastBuildAt:       pollJobs.rows[0]?.last_build || null,
    lastCommitAt:      pollJobs.rows[0]?.last_build || null,
    healthScore:       parseFloat(healthScore.toFixed(1)),
    buildStatus,
  };
}

async function refreshRepoMetrics(repoFullName: string, repoName: string): Promise<RepoStats> {
  const priority = DEFAULT_PRIORITIES[repoName] || 'medium';
  const stats    = await getRepoStats(repoFullName, repoName);
  await upsertRepoMetrics({ repoFullName, repoName, ...stats, priority });
  return stats;
}

async function refreshAllMetrics(): Promise<Array<RepoStats & { repoName: string; repoFullName: string; priority: string }>> {
  const results: Array<RepoStats & { repoName: string; repoFullName: string; priority: string }> = [];

  const { getFullRepoList } = require('./repoDiscovery') as { getFullRepoList: () => Promise<Array<{ repoName: string; repoFullName: string }>> };
  const repoList = await getFullRepoList().catch(() => REPO_LIST);

  for (const repo of repoList) {
    try {
      const stats    = await getRepoStats(repo.repoFullName, repo.repoName);
      const priority = DEFAULT_PRIORITIES[repo.repoName] || 'medium';

      await upsertRepoMetrics({ ...repo, ...stats, priority });
      results.push({ ...repo, ...stats, priority });
    } catch (err: any) {
      logger.warn({ err: err.message, repo: repo.repoName },
        'Could not refresh metrics for repo');
    }
  }

  return results;
}

async function getPortfolioSummary(): Promise<PortfolioSummary> {
  const metrics     = await getAllLatestMetrics();
  const dailyCost   = await getDailyCost();
  const monthlyCost = await getMonthlyCost();

  const healthy   = metrics.filter((m) => m.build_status === 'passing');
  const broken    = metrics.filter((m) => m.build_status === 'failed');
  const unknown   = metrics.filter((m) => m.build_status === 'unknown');
  const avgHealth = metrics.length > 0
    ? (metrics.reduce((s: number, m) => s + parseFloat(m.health_score || '5'), 0) / metrics.length).toFixed(1)
    : '5.0';

  return {
    metrics,
    healthy,
    broken,
    unknown,
    avgHealth,
    dailyCost,
    monthlyCost,
    totalRepos: REPO_LIST.length,
  };
}

export = { refreshAllMetrics, refreshRepoMetrics, getPortfolioSummary, getRepoStats, REPO_LIST };
