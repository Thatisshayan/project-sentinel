const axios  = require('axios');
const logger = require('./logger');
const { upsertRepoMetrics } = require('./portfolioDb');
const { REPO_LIST } = require('./portfolioAnalytics');
const { query } = require('./dbClient');

const PRIORITIES = {
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

async function fetchRepoGitHubStats(repoFullName, repoName) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept:        'application/vnd.github+json',
  };

  let latestCommitAt = null;
  let buildStatus    = 'unknown';
  let buildsPassed   = 0;
  let buildsFailed   = 0;

  // Latest commit timestamp
  try {
    const commitRes = await axios.get(
      `https://api.github.com/repos/${repoFullName}/commits?per_page=1`,
      { headers, timeout: 8000 }
    );
    const latest = commitRes.data?.[0];
    if (latest?.commit?.committer?.date) {
      latestCommitAt = new Date(latest.commit.committer.date);
    }
  } catch (e) {
    logger.warn({ err: e.message, repo: repoName }, 'Could not fetch latest commit');
  }

  // Latest CI runs (last 10 completed runs)
  try {
    const runsRes = await axios.get(
      `https://api.github.com/repos/${repoFullName}/actions/runs?per_page=10&status=completed`,
      { headers, timeout: 8000 }
    );
    const runs = runsRes.data?.workflow_runs || [];
    for (const run of runs) {
      if (run.conclusion === 'success') buildsPassed++;
      else buildsFailed++;
    }
    const latestRun = runs[0];
    if (latestRun) {
      buildStatus = latestRun.conclusion === 'success' ? 'passing'
                 : latestRun.conclusion === 'failure'  ? 'failed'
                 : 'unknown';
    }
  } catch (e) {
    if (e.response?.status === 404) {
      // No Actions configured for this repo — not an error
      buildStatus = 'unknown';
    } else {
      logger.warn({ err: e.message, repo: repoName }, 'Could not fetch CI runs');
    }
  }

  return { latestCommitAt, buildStatus, buildsPassed, buildsFailed };
}

async function syncAllRepoMetrics() {
  if (!process.env.GITHUB_TOKEN) {
    logger.warn('GITHUB_TOKEN not set — skipping GitHub metrics sync');
    return;
  }

  const { getFullRepoList } = require('./repoDiscovery');
  const repoList = await getFullRepoList().catch(() => REPO_LIST);

  logger.info({ repoCount: repoList.length }, 'Starting GitHub metrics sync');
  let synced = 0;

  for (const repo of repoList) {
    try {
      const ghStats = await fetchRepoGitHubStats(repo.repoFullName, repo.repoName);
      if (!ghStats) continue;

      const taskStats = await query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'done')   as done,
          COUNT(*) FILTER (WHERE status = 'queued') as queued
        FROM audit_tasks
        WHERE repo_full_name = $1
      `, [repo.repoFullName]);

      const taskDone   = parseInt(taskStats.rows[0]?.done   || 0);
      const taskQueued = parseInt(taskStats.rows[0]?.queued || 0);

      const totalRuns = ghStats.buildsPassed + ghStats.buildsFailed;
      const passRate  = totalRuns > 0
        ? ghStats.buildsPassed / totalRuns
        : ghStats.buildStatus === 'passing' ? 1
        : ghStats.buildStatus === 'failed'  ? 0
        : 0.5;

      let healthScore = 5.0;
      healthScore += passRate * 3;
      if (taskDone   > 0) healthScore += Math.min(taskDone   * 0.2, 1.5);
      if (taskQueued > 0) healthScore -= Math.min(taskQueued * 0.1, 0.5);
      if (ghStats.buildsFailed > 0) healthScore -= Math.min(ghStats.buildsFailed * 0.3, 1.5);
      healthScore = parseFloat(Math.max(1, Math.min(10, healthScore)).toFixed(1));

      await upsertRepoMetrics({
        repoFullName:       repo.repoFullName,
        repoName:           repo.repoName,
        healthScore,
        buildStatus:        ghStats.buildStatus,
        priority:           PRIORITIES[repo.repoName] || 'medium',
        buildsPassedToday:  ghStats.buildsPassed,
        buildsFailedToday:  ghStats.buildsFailed,
        tasksDoneToday:     taskDone,
        tasksQueued:        taskQueued,
        debuggerRunsToday:  ghStats.buildsFailed,
        lastCommitAt:       ghStats.latestCommitAt,
        lastBuildAt:        ghStats.latestCommitAt,
      });

      synced++;
      logger.info({ repo: repo.repoName, healthScore, buildStatus: ghStats.buildStatus },
        'Repo metrics synced from GitHub');

      // Pace requests to avoid hitting GitHub rate limit (5000/hour)
      await new Promise(r => setTimeout(r, 200));

    } catch (err) {
      logger.warn({ err: err.message, repo: repo.repoName }, 'GitHub metrics sync failed for repo');
    }
  }

  logger.info({ synced, total: repoList.length }, 'GitHub metrics sync complete');
  return { synced, total: repoList.length };
}

module.exports = { syncAllRepoMetrics };
