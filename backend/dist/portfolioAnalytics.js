"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const logger_1 = __importDefault(require("./logger"));
const dbClient_1 = require("./dbClient");
const portfolioDb_1 = require("./portfolioDb");
const repoResolver_1 = require("./repoResolver");
function buildRepoList() {
    try {
        const watched = process.env['WATCHED_REPOS'];
        const names = watched
            ? watched.split(',').map((s) => s.trim()).filter(Boolean)
            : ['acc', 'tapcash', 'AlphonsoEcosystem', 'session-guard', 'costpilot',
                'shiporex', 'aegis', 'mint', 'agents-ops-board', 'founder-social-club',
                'obsidian-studio', 'obsidian-media'];
        return names.map((repoName) => ({ repoName, repoFullName: (0, repoResolver_1.repoFullName)(repoName) }));
    }
    catch {
        return [];
    }
}
const REPO_LIST = buildRepoList();
const DEFAULT_PRIORITIES = {
    'acc': 'critical',
    'tapcash': 'critical',
    'AlphonsoEcosystem': 'high',
    'session-guard': 'high',
    'costpilot': 'high',
    'shiporex': 'medium',
    'aegis': 'medium',
    'mint': 'medium',
    'agents-ops-board': 'low',
    'founder-social-club': 'low',
    'obsidian-studio': 'low',
    'obsidian-media': 'low',
};
async function getRepoStats(repoFullName, repoName) {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const pollJobs = await (0, dbClient_1.query)(`
    SELECT COUNT(*) as total, MAX(created_at) as last_build
    FROM build_poll_jobs
    WHERE repo_full_name = $1 AND created_at > $2
  `, [repoFullName, since24h]);
    const failures = await (0, dbClient_1.query)(`
    SELECT COUNT(*) as failed_count
    FROM debug_attempts
    WHERE repo_full_name = $1 AND created_at > $2
  `, [repoFullName, since24h]);
    const latestDebug = await (0, dbClient_1.query)(`
    SELECT status FROM debug_attempts
    WHERE repo_full_name = $1
    ORDER BY created_at DESC LIMIT 1
  `, [repoFullName]);
    const taskStats = await (0, dbClient_1.query)(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'done')   as done,
      COUNT(*) FILTER (WHERE status = 'queued') as queued
    FROM audit_tasks
    WHERE repo_full_name = $1
  `, [repoFullName]);
    const totalBuilds = parseInt(pollJobs.rows[0]?.total || '0');
    const failedBuilds = parseInt(failures.rows[0]?.failed_count || '0');
    const passedBuilds = Math.max(0, totalBuilds - failedBuilds);
    const latestStatus = latestDebug.rows[0]?.status || null;
    const taskDone = parseInt(taskStats.rows[0]?.done || 0);
    const taskQueued = parseInt(taskStats.rows[0]?.queued || 0);
    let buildStatus = 'unknown';
    if (totalBuilds > 0) {
        buildStatus = failedBuilds === 0 ? 'passing' : 'failed';
    }
    else if (latestStatus === 'resolved') {
        buildStatus = 'passing';
    }
    else if (latestStatus && latestStatus !== 'stopped') {
        buildStatus = 'failed';
    }
    const passRate = totalBuilds > 0
        ? passedBuilds / totalBuilds
        : buildStatus === 'passing' ? 1 : buildStatus === 'failed' ? 0 : 0.5;
    let healthScore = 5.0;
    healthScore += passRate * 3;
    if (taskDone > 0)
        healthScore += Math.min(taskDone * 0.2, 1.5);
    if (taskQueued > 0)
        healthScore -= Math.min(taskQueued * 0.1, 0.5);
    if (failedBuilds > 0)
        healthScore -= failedBuilds * 0.5;
    healthScore = Math.max(1, Math.min(10, healthScore));
    return {
        buildsPassedToday: passedBuilds,
        buildsFailedToday: failedBuilds,
        debuggerRunsToday: failedBuilds,
        tasksDoneToday: taskDone,
        tasksQueued: taskQueued,
        lastBuildAt: pollJobs.rows[0]?.last_build || null,
        lastCommitAt: pollJobs.rows[0]?.last_build || null,
        healthScore: parseFloat(healthScore.toFixed(1)),
        buildStatus,
    };
}
async function refreshRepoMetrics(repoFullName, repoName) {
    const priority = DEFAULT_PRIORITIES[repoName] || 'medium';
    const stats = await getRepoStats(repoFullName, repoName);
    await (0, portfolioDb_1.upsertRepoMetrics)({ repoFullName, repoName, ...stats, priority });
    return stats;
}
async function refreshAllMetrics() {
    const results = [];
    const { getFullRepoList } = require('./repoDiscovery');
    const repoList = await getFullRepoList().catch(() => REPO_LIST);
    for (const repo of repoList) {
        try {
            const stats = await getRepoStats(repo.repoFullName, repo.repoName);
            const priority = DEFAULT_PRIORITIES[repo.repoName] || 'medium';
            await (0, portfolioDb_1.upsertRepoMetrics)({ ...repo, ...stats, priority });
            results.push({ ...repo, ...stats, priority });
        }
        catch (err) {
            logger_1.default.warn({ err: err.message, repo: repo.repoName }, 'Could not refresh metrics for repo');
        }
    }
    return results;
}
async function getPortfolioSummary() {
    const metrics = await (0, portfolioDb_1.getAllLatestMetrics)();
    const dailyCost = await (0, portfolioDb_1.getDailyCost)();
    const monthlyCost = await (0, portfolioDb_1.getMonthlyCost)();
    const healthy = metrics.filter((m) => m.build_status === 'passing');
    const broken = metrics.filter((m) => m.build_status === 'failed');
    const unknown = metrics.filter((m) => m.build_status === 'unknown');
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
module.exports = { refreshAllMetrics, refreshRepoMetrics, getPortfolioSummary, getRepoStats, REPO_LIST };
//# sourceMappingURL=portfolioAnalytics.js.map