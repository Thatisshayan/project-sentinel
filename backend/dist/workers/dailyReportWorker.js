"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startDailyReportWorker = startDailyReportWorker;
const bullmq_1 = require("bullmq");
const queueClient_1 = require("../queueClient");
const safeFire_1 = require("../utils/safeFire");
const agentRoom_1 = require("../agentRoom");
const businessMetrics_1 = require("../businessMetrics");
const weeklyBusinessReport_1 = require("../weeklyBusinessReport");
const monthlySecurityReport_1 = require("../monthlySecurityReport");
const roiScorer_1 = require("../roiScorer");
const dailyReport_1 = require("../dailyReport");
const patternDetector_1 = require("../patternDetector");
const portfolioAnalytics_1 = require("../portfolioAnalytics");
const githubMetricsSyncer_1 = require("../githubMetricsSyncer");
const notionDashboard_1 = require("../notionDashboard");
const telegramClient_1 = require("../telegramClient");
const auditOrchestrator_1 = require("../auditOrchestrator");
const logger_1 = __importDefault(require("../logger"));
const dbClient_1 = __importDefault(require("../dbClient"));
const { query } = dbClient_1.default;
const SENTINEL_TZ = process.env['SENTINEL_TIMEZONE'] || 'America/Toronto';
// Lazy optional module loads (preserve cycle-breaking requires)
let fetchAllMetrics;
try {
    ({ fetchAllMetrics } = require('../metricsFetcher'));
}
catch (e) {
    logger_1.default.warn({ err: e.message }, 'metricsFetcher failed to load');
}
let runSelfScaler;
try {
    ({ runSelfScaler } = require('../selfScaler'));
}
catch (e) {
    logger_1.default.warn({ err: e.message }, 'selfScaler failed to load');
}
let runPriorityEngine;
try {
    ({ runPriorityEngine } = require('../priorityEngine'));
}
catch (e) {
    logger_1.default.warn({ err: e.message }, 'priorityEngine failed to load');
}
let generateCEOReport;
try {
    ({ generateCEOReport } = require('../ceoReport'));
}
catch (e) {
    logger_1.default.warn({ err: e.message }, 'ceoReport failed to load');
}
let runAgentStandup;
try {
    ({ runAgentStandup } = require('../agentStandup'));
}
catch (e) {
    logger_1.default.warn({ err: e.message }, 'agentStandup failed to load');
}
let postAgentLeaderboard;
try {
    ({ postAgentLeaderboard } = require('../agentLeaderboard'));
}
catch (e) {
    logger_1.default.warn({ err: e.message }, 'agentLeaderboard failed to load');
}
let runStrategicBrain;
let recordBrainOutcome;
try {
    ({ runStrategicBrain, recordBrainOutcome } = require('../sentinelBrain'));
}
catch (e) {
    logger_1.default.warn({ err: e.message }, 'sentinelBrain failed to load');
}
function startDailyReportWorker() {
    const conn = (0, queueClient_1.getRedisConnection)();
    if (!conn) {
        logger_1.default.warn('REDIS_URL not configured — daily report worker not started');
        return null;
    }
    const queue = new bullmq_1.Queue('daily-report', { connection: conn });
    queue.add('report', {}, {
        repeat: { pattern: '0 9 * * *', tz: SENTINEL_TZ },
        jobId: 'daily-report-cron',
    }).catch((err) => logger_1.default.warn({ err: err.message }, 'Could not schedule daily report cron'));
    queue.add('morning-briefing', {}, {
        repeat: { pattern: '0 8 * * *', tz: SENTINEL_TZ },
        jobId: 'morning-briefing-cron',
    }).catch((err) => logger_1.default.warn({ err: err.message }, 'Could not schedule morning briefing cron'));
    queue.add('pull-metrics', {}, {
        repeat: { pattern: '0 6 * * *', tz: SENTINEL_TZ },
        jobId: 'metrics-pull-cron',
    }).catch((err) => logger_1.default.warn({ err: err.message }, 'Could not schedule metrics pull cron'));
    queue.add('weekly-report', {}, {
        repeat: { pattern: '0 8 * * 1', tz: SENTINEL_TZ },
        jobId: 'weekly-report-cron',
    }).catch((err) => logger_1.default.warn({ err: err.message }, 'Could not schedule weekly report cron'));
    queue.add('monthly-security', {}, {
        repeat: { pattern: '0 8 1 * *', tz: SENTINEL_TZ },
        jobId: 'monthly-security-cron',
    }).catch((err) => logger_1.default.warn({ err: err.message }, 'Could not schedule monthly security cron'));
    queue.add('priority-engine', {}, {
        repeat: { pattern: '30 6 * * *', tz: SENTINEL_TZ },
        jobId: 'priority-engine-cron',
    }).catch((err) => logger_1.default.warn({ err: err.message }, 'Could not schedule priority engine cron'));
    queue.add('agent-standup', {}, {
        repeat: { pattern: '0 9 * * *', tz: SENTINEL_TZ },
        jobId: 'agent-standup-cron',
    }).catch((err) => logger_1.default.warn({ err: err.message }, 'Could not schedule agent standup cron'));
    queue.add('ceo-report', {}, {
        repeat: { pattern: '0 22 * * 0', tz: SENTINEL_TZ },
        jobId: 'ceo-report-cron',
    }).catch((err) => logger_1.default.warn({ err: err.message }, 'Could not schedule CEO report cron'));
    queue.add('agent-leaderboard', {}, {
        repeat: { pattern: '30 22 * * 0', tz: SENTINEL_TZ },
        jobId: 'agent-leaderboard-cron',
    }).catch((err) => logger_1.default.warn({ err: err.message }, 'Could not schedule agent leaderboard cron'));
    queue.add('weekly-audit', {}, {
        repeat: { pattern: '0 23 * * 0', tz: SENTINEL_TZ },
        jobId: 'weekly-audit-cron',
    }).catch((err) => logger_1.default.warn({ err: err.message }, 'Could not schedule weekly audit cron'));
    queue.add('stale-tasks', {}, {
        repeat: { pattern: '0 17 * * 5', tz: SENTINEL_TZ },
        jobId: 'stale-tasks-cron',
    }).catch((err) => logger_1.default.warn({ err: err.message }, 'Could not schedule stale tasks cron'));
    queue.add('provider-health', {}, {
        repeat: { pattern: '0 5 * * *', tz: SENTINEL_TZ },
        jobId: 'provider-health-cron',
    }).catch((err) => logger_1.default.warn({ err: err.message }, 'Could not schedule provider health cron'));
    queue.add('github-metrics-sync', {}, {
        repeat: { every: 3 * 60 * 60 * 1000 },
        jobId: 'github-metrics-sync-repeat',
    }).catch((err) => logger_1.default.warn({ err: err.message }, 'Could not schedule GitHub metrics sync'));
    queue.add('repo-discovery', {}, {
        repeat: { every: 30 * 60 * 1000 },
        jobId: 'repo-discovery-repeat',
    }).catch((err) => logger_1.default.warn({ err: err.message }, 'Could not schedule repo discovery'));
    queue.add('brain-outcome', {}, {
        repeat: { pattern: '55 6 * * *', tz: SENTINEL_TZ },
        jobId: 'brain-outcome-cron',
    }).catch((err) => logger_1.default.warn({ err: err.message }, 'Could not schedule brain outcome cron'));
    queue.add('brain-strategy', {}, {
        repeat: { pattern: '0 7 * * *', tz: SENTINEL_TZ },
        jobId: 'brain-strategy-cron',
    }).catch((err) => logger_1.default.warn({ err: err.message }, 'Could not schedule brain strategy cron'));
    const worker = new bullmq_1.Worker('daily-report', async (job) => {
        if (job.name === 'morning-briefing') {
            await (0, agentRoom_1.sendMorningBriefing)();
            return;
        }
        if (job.name === 'pull-metrics') {
            await (0, businessMetrics_1.pullAllMetrics)();
            if (fetchAllMetrics)
                await fetchAllMetrics().catch((e) => logger_1.default.warn({ err: e.message }, 'metricsFetcher failed'));
            await (0, roiScorer_1.scoreAllQueuedTasks)();
            if (runSelfScaler)
                await (0, safeFire_1.safeFire)(runSelfScaler(), { label: 'workers' });
            return;
        }
        if (job.name === 'weekly-report') {
            await (0, weeklyBusinessReport_1.generateWeeklyReport)();
            return;
        }
        if (job.name === 'monthly-security') {
            await (0, monthlySecurityReport_1.generateMonthlySecurityReport)();
            return;
        }
        if (job.name === 'priority-engine') {
            if (runPriorityEngine)
                await runPriorityEngine();
            else
                logger_1.default.warn('priority-engine job fired but priorityEngine module did not load');
            return;
        }
        if (job.name === 'agent-standup') {
            if (runAgentStandup)
                await runAgentStandup();
            else
                logger_1.default.warn('agent-standup job fired but agentStandup module did not load');
            return;
        }
        if (job.name === 'ceo-report') {
            if (generateCEOReport)
                await generateCEOReport(null);
            else
                logger_1.default.warn('ceo-report job fired but ceoReport module did not load');
            return;
        }
        if (job.name === 'agent-leaderboard') {
            if (postAgentLeaderboard)
                await postAgentLeaderboard();
            else
                logger_1.default.warn('agent-leaderboard job fired but agentLeaderboard module did not load');
            return;
        }
        if (job.name === 'weekly-audit') {
            const { REPO_LIST } = require('../portfolioAnalytics');
            let audited = 0;
            for (const repo of REPO_LIST) {
                try {
                    await (0, auditOrchestrator_1.triggerAudit)({
                        repoFullName: repo.repoFullName,
                        repoName: repo.repoName,
                        projectName: repo.repoName,
                        commitSha: `weekly-audit-${Date.now()}`,
                        commitMessage: '[weekly-audit]',
                        branchName: 'main',
                        authorName: 'Sentinel',
                        authorEmail: '',
                        topicId: null,
                    });
                    audited++;
                    await new Promise(r => setTimeout(r, 3000));
                }
                catch (e) {
                    logger_1.default.warn({ err: e.message, repo: repo.repoName }, 'Weekly audit failed for repo');
                }
            }
            await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)(`🔍 Weekly audit sweep — ${audited}/${REPO_LIST.length} repos queued for audit.`, null, null), { label: 'workers' });
            return;
        }
        if (job.name === 'stale-tasks') {
            const result = await query(`
        SELECT repo_full_name, COUNT(*) AS count
        FROM audit_tasks
        WHERE status = 'queued'
          AND created_at < NOW() - INTERVAL '7 days'
        GROUP BY repo_full_name
        ORDER BY count DESC
      `).catch(() => null);
            const rows = result?.rows || [];
            if (rows.length === 0) {
                logger_1.default.info('Stale task check — no stale tasks found');
                return;
            }
            const lines = rows.map((r) => `  · ${r.repo_full_name.split('/')[1]}: ${r.count} task(s)`).join('\n');
            await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)(`🕰️ Stale Task Report — tasks queued >7 days:\n\n${lines}\n\n` +
                `Run: /sentinel force-execute <repo> to execute, or /sentinel skip <repo> to clear.`, null, null), { label: 'workers' });
            return;
        }
        if (job.name === 'provider-health') {
            const { probeAIProviders } = require('../providerHealthCheck');
            await probeAIProviders().catch((e) => logger_1.default.warn({ err: e.message }, 'Daily provider health probe failed'));
            return;
        }
        if (job.name === 'github-metrics-sync') {
            await (0, githubMetricsSyncer_1.syncAllRepoMetrics)().catch((e) => logger_1.default.warn({ err: e.message }, 'GitHub metrics sync failed'));
            return;
        }
        if (job.name === 'repo-discovery') {
            const { discoverAndOnboardRepos } = require('../repoDiscovery');
            await discoverAndOnboardRepos().catch((e) => logger_1.default.warn({ err: e.message }, 'Repo discovery failed'));
            return;
        }
        if (job.name === 'brain-outcome') {
            if (recordBrainOutcome)
                await recordBrainOutcome();
            else
                logger_1.default.warn('brain-outcome job fired but sentinelBrain module did not load');
            return;
        }
        if (job.name === 'brain-strategy') {
            if (runStrategicBrain)
                await runStrategicBrain(null);
            else
                logger_1.default.warn('brain-strategy job fired but sentinelBrain module did not load');
            return;
        }
        await (0, portfolioAnalytics_1.refreshAllMetrics)();
        try {
            const { getDailyCost } = require('../portfolioDb');
            const dailyCost = await getDailyCost();
            const alertThreshold = parseFloat(process.env['DAILY_COST_ALERT_USD'] || '5');
            if (dailyCost > alertThreshold) {
                await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)(`💸 Cost Alert — $${dailyCost.toFixed(2)} spent today (limit: $${alertThreshold})\n` +
                    `Use /sentinel costs for a full breakdown.`, null, null), { label: 'workers' });
            }
        }
        catch (e) {
            logger_1.default.warn({ err: e.message }, 'Cost alert check failed');
        }
        await (0, dailyReport_1.sendDailyReport)();
        await (0, patternDetector_1.detectPatterns)();
        await (0, notionDashboard_1.updateDashboard)();
    }, { connection: conn });
    worker.on('failed', (job, err) => {
        logger_1.default.error({ err: err.stack ?? err.message }, 'Daily report worker failed');
    });
    logger_1.default.info('Daily report worker started — fires at 9am Toronto');
    return worker;
}
//# sourceMappingURL=dailyReportWorker.js.map