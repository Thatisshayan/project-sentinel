const logger = require('./logger');
const { query }             = require('./dbClient');
const {
  upsertRepoMetrics,
  getAllLatestMetrics,
  getDailyCost,
  getMonthlyCost,
} = require('./portfolioDb');

const REPO_LIST = [
  { repoName: 'acc',                 repoFullName: 'Thatisshayan/acc' },
  { repoName: 'tapcash',             repoFullName: 'Thatisshayan/tapcash' },
  { repoName: 'AlphonsoEcosystem',   repoFullName: 'Thatisshayan/AlphonsoEcosystem' },
  { repoName: 'session-guard',       repoFullName: 'Thatisshayan/session-guard' },
  { repoName: 'costpilot',           repoFullName: 'Thatisshayan/costpilot' },
  { repoName: 'shiporex',            repoFullName: 'Thatisshayan/shiporex' },
  { repoName: 'aegis',               repoFullName: 'Thatisshayan/aegis' },
  { repoName: 'mint',                repoFullName: 'Thatisshayan/mint' },
  { repoName: 'agents-ops-board',    repoFullName: 'Thatisshayan/agents-ops-board' },
  { repoName: 'founder-social-club', repoFullName: 'Thatisshayan/founder-social-club' },
  { repoName: 'obsidian-studio',     repoFullName: 'Thatisshayan/obsidian-studio' },
  { repoName: 'obsidian-media',      repoFullName: 'Thatisshayan/obsidian-media' },
];

const DEFAULT_PRIORITIES = {
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

async function getRepoStats(repoFullName, repoName) {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const builds = await query(`
    SELECT
      COUNT(*) FILTER (WHERE result = 'success') as passed,
      COUNT(*) FILTER (WHERE result = 'failed')  as failed,
      MAX(created_at) as last_build
    FROM build_poll_jobs
    WHERE repo_full_name = $1 AND created_at > $2
  `, [repoFullName, since24h]);

  const debugRuns = await query(`
    SELECT COUNT(*) as count FROM debug_attempts
    WHERE repo_full_name = $1 AND created_at > $2
  `, [repoFullName, since24h]);

  const taskStats = await query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'done')   as done,
      COUNT(*) FILTER (WHERE status = 'queued') as queued
    FROM audit_tasks
    WHERE repo_full_name = $1
  `, [repoFullName]);

  const b          = builds.rows[0];
  const totalBuilds = parseInt(b.passed) + parseInt(b.failed);
  const passRate    = totalBuilds > 0 ? parseInt(b.passed) / totalBuilds : 1;
  const taskDone    = parseInt(taskStats.rows[0]?.done   || 0);
  const taskQueued  = parseInt(taskStats.rows[0]?.queued || 0);

  let healthScore = 5.0;
  healthScore += passRate * 3;
  if (taskDone   > 0) healthScore += Math.min(taskDone   * 0.2, 1.5);
  if (taskQueued > 0) healthScore -= Math.min(taskQueued * 0.1, 0.5);
  if (parseInt(b.failed) > 0) healthScore -= parseInt(b.failed) * 0.5;
  healthScore = Math.max(1, Math.min(10, healthScore));

  return {
    buildsPassedToday: parseInt(b.passed || 0),
    buildsFailedToday: parseInt(b.failed || 0),
    debuggerRunsToday: parseInt(debugRuns.rows[0]?.count || 0),
    tasksDoneToday:    taskDone,
    tasksQueued:       taskQueued,
    lastBuildAt:       b.last_build || null,
    healthScore:       parseFloat(healthScore.toFixed(1)),
    buildStatus:       parseInt(b.failed) > 0 ? 'failed' :
                       totalBuilds > 0        ? 'passing' : 'unknown',
  };
}

async function refreshAllMetrics() {
  const results = [];

  for (const repo of REPO_LIST) {
    try {
      const stats    = await getRepoStats(repo.repoFullName, repo.repoName);
      const priority = DEFAULT_PRIORITIES[repo.repoName] || 'medium';

      await upsertRepoMetrics({ ...repo, ...stats, priority });
      results.push({ ...repo, ...stats, priority });
    } catch (err) {
      logger.warn({ err: err.message, repo: repo.repoName },
        'Could not refresh metrics for repo');
    }
  }

  return results;
}

async function getPortfolioSummary() {
  const metrics     = await getAllLatestMetrics();
  const dailyCost   = await getDailyCost();
  const monthlyCost = await getMonthlyCost();

  const healthy   = metrics.filter(m => m.build_status === 'passing');
  const broken    = metrics.filter(m => m.build_status === 'failed');
  const unknown   = metrics.filter(m => m.build_status === 'unknown');
  const avgHealth = metrics.length > 0
    ? (metrics.reduce((s, m) => s + parseFloat(m.health_score || 5), 0) / metrics.length).toFixed(1)
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

module.exports = { refreshAllMetrics, getPortfolioSummary, getRepoStats, REPO_LIST };
