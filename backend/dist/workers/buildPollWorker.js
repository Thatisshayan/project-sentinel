"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startBuildPollWorker = startBuildPollWorker;
const bullmq_1 = require("bullmq");
const queueClient_1 = require("../queueClient");
const securityScanner_1 = require("../securityScanner");
const buildPoller_1 = require("../buildPoller");
const debugOrchestrator_1 = require("../debugOrchestrator");
const telegramClient_1 = require("../telegramClient");
const notionClient_1 = require("../notionClient");
const logger_1 = __importDefault(require("../logger"));
const auditOrchestrator_1 = require("../auditOrchestrator");
const portfolioAnalytics_1 = require("../portfolioAnalytics");
const notionDashboard_1 = require("../notionDashboard");
const dbClient_1 = __importDefault(require("../dbClient"));
const safeFire_1 = require("../utils/safeFire");
const { query } = dbClient_1.default;
const SENTINEL_TZ = process.env['SENTINEL_TIMEZONE'] || 'America/Toronto';
const POLL_INTERVAL_MS = 30 * 1000;
const MAX_POLL_ATTEMPTS = 20;
// ── Build poll worker ─────────────────────────────────────────────────────────
function startBuildPollWorker() {
    const conn = (0, queueClient_1.getRedisConnection)();
    if (!conn) {
        logger_1.default.warn('REDIS_URL not configured — build poll worker not started');
        return null;
    }
    const worker = new bullmq_1.Worker('build-poll', async (job) => {
        const data = job.data;
        const { repoFullName, commitSha, repoName, projectName, topicId, attemptNumber = 0 } = data;
        logger_1.default.info({ repoFullName, commitSha: commitSha?.slice(0, 7), pollAttempt: attemptNumber }, 'Build poll job running');
        // Check build status
        const result = await (0, buildPoller_1.checkAllProviders)(repoFullName, commitSha);
        if (result.overall === 'pending') {
            // Still building — re-queue after interval if under max attempts
            if (attemptNumber >= MAX_POLL_ATTEMPTS) {
                logger_1.default.warn({ repoFullName }, 'Build poll timeout');
                await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)(`Project Sentinel — Build Timeout ⏱️\n\nRepo: ${repoName}\nBuild still pending after 10 minutes.\nCheck manually: ${result.buildUrl || 'N/A'}`, null, topicId), { label: 'workers' });
                return;
            }
            // Re-queue with incremented attempt count
            await (0, queueClient_1.enqueueBuildCheck)({
                ...data,
                attemptNumber: attemptNumber + 1,
            }).catch((err) => logger_1.default.error({ err: err.stack ?? err.message }, 'Failed to re-queue build check'));
            return;
        }
        if (result.overall === 'not_configured') {
            logger_1.default.info({ repoFullName }, 'No build providers configured — skipping');
            return;
        }
        // Build resolved — update Notion
        try {
            const project = await (0, notionClient_1.findNotionProject)(repoName);
            if (project) {
                await (0, notionClient_1.updateNotionProject)(project.pageId, {
                    deploymentStatus: result.overall,
                    buildProvider: result.buildProvider,
                    buildUrl: result.buildUrl,
                    currentProjectState: result.overall === 'success' ? 'Resolved' : 'Broken',
                    lastBuildError: result.overall === 'failed'
                        ? (result.failureReason || '').substring(0, 500)
                        : undefined,
                });
            }
        }
        catch (err) {
            logger_1.default.warn({ err: err.message }, 'Could not update Notion after build poll');
        }
        if (result.overall === 'success') {
            logger_1.default.info({ repoFullName }, 'Build passed');
            await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)([
                `Project Sentinel — Build Passed ✅`,
                ``,
                `Project: ${projectName || repoName}`,
                `Repo: ${repoName}`,
                `Commit: ${commitSha.substring(0, 7)}`,
                `Provider: ${result.buildProvider}`,
                result.buildUrl ? `Build: ${result.buildUrl}` : '',
            ].filter(Boolean).join('\n'), null, topicId), { label: 'workers' });
            // Phase 3 — route based on whether this is a Sentinel PR or human commit
            const isSentinelBranch = (data.branchName || '').startsWith('sentinel/');
            if (isSentinelBranch) {
                // Build passed after Sentinel PR was merged — mark tasks done, start next batch
                await (0, auditOrchestrator_1.handleBuildPassedAfterSentinelMerge)(repoFullName, data.repoName, data.branchName, data.topicId).catch((err) => logger_1.default.error({ err: err.stack ?? err.message }, 'handleBuildPassedAfterSentinelMerge failed'));
            }
            else if (process.env['AUDIT_AGENT_ENABLED'] !== 'false') {
                // Human commit — trigger fresh audit (subject to 4 rules in auditOrchestrator)
                await (0, auditOrchestrator_1.triggerAudit)({
                    repoFullName,
                    repoName: data.repoName,
                    projectName: data.projectName,
                    commitSha,
                    commitMessage: data.commitMessage,
                    branchName: data.branchName,
                    authorName: data.authorName,
                    authorEmail: data.authorEmail,
                    topicId: data.topicId,
                }).catch((err) => logger_1.default.error({ err: err.stack ?? err.message }, 'Audit trigger failed'));
            }
            // Phase 9 — security scan on every passing build (non-blocking)
            (0, securityScanner_1.runSecurityScan)({
                repoFullName,
                repoName: data.repoName,
                commitSha,
                branchName: data.branchName,
                topicId: data.topicId,
            }).catch((err) => logger_1.default.error({ err: err.stack ?? err.message }, 'Security scan failed'));
            (0, portfolioAnalytics_1.refreshRepoMetrics)(repoFullName, repoName)
                .catch((err) => logger_1.default.warn({ err: err.message }, 'Post-build metrics refresh failed'));
            // Phase 4 — update dashboard on every build result
            (0, safeFire_1.fireAndForget)((0, notionDashboard_1.updateDashboard)(), { label: 'workers' });
            return;
        }
        if (result.overall === 'failed') {
            logger_1.default.info({ repoFullName }, 'Build failed — notifying and triggering debug');
            const isSentinelBranchFailed = (data.branchName || '').startsWith('sentinel/');
            await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)([
                `Project Sentinel — Build Failed ❌`,
                ``,
                `Project: ${projectName || repoName}`,
                `Repo: ${repoName}`,
                `Commit: ${commitSha.substring(0, 7)}`,
                `Provider: ${result.buildProvider}`,
                result.buildUrl ? `Build: ${result.buildUrl}` : '',
                `Reason: ${result.failureReason || 'See build logs'}`,
                ``,
                isSentinelBranchFailed
                    ? `This was a Sentinel PR — tasks have been re-queued for retry.`
                    : `Assessing whether automatic repair is safe...`,
            ].filter(Boolean).join('\n'), null, topicId), { label: 'workers' });
            if (isSentinelBranchFailed) {
                // A Sentinel-created PR was merged but the post-merge build failed.
                // Re-queue tasks that were marked done in the last hour so they can be retried.
                const requeued = await query(`
          UPDATE audit_tasks
          SET status = 'queued', safe_to_auto_execute = false,
              branch_name = NULL, commit_sha = NULL,
              pr_url = NULL, pr_number = NULL, updated_at = NOW()
          WHERE repo_full_name = $1
            AND status = 'done'
            AND updated_at > NOW() - INTERVAL '1 hour'
          RETURNING id
        `, [repoFullName]).catch(() => null);
                const count = requeued?.rows?.length || 0;
                if (count > 0) {
                    logger_1.default.info({ count, repoFullName }, 'Tasks re-queued after post-merge build failure');
                    await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)(`🔁 ${count} task(s) re-queued for ${repoName} — use /sentinel tasks ${repoName} to review, then /sentinel force-execute ${repoName} to retry.`, null, topicId), { label: 'workers' });
                }
            }
            else {
                // Human commit failure — trigger debug orchestrator
                await (0, debugOrchestrator_1.orchestrateDebug)({
                    projectName,
                    repoName,
                    repoFullName,
                    branchName: data.branchName,
                    commitSha,
                    commitUrl: data.commitUrl,
                    commitMessage: data.commitMessage,
                    authorName: data.authorName,
                    changedFiles: data.changedFiles || [],
                    buildProvider: result.buildProvider,
                    buildUrl: result.buildUrl,
                    logsUrl: result.logsUrl,
                    failureReason: result.failureReason,
                    failureLogs: '',
                    topicId,
                });
            }
            (0, portfolioAnalytics_1.refreshRepoMetrics)(repoFullName, repoName)
                .catch((err) => logger_1.default.warn({ err: err.message }, 'Post-build metrics refresh failed'));
            // Phase 4 — update dashboard on build failure too
            (0, safeFire_1.fireAndForget)((0, notionDashboard_1.updateDashboard)(), { label: 'workers' });
        }
    }, {
        connection: conn,
        concurrency: 5,
    });
    worker.on('failed', (job, err) => {
        logger_1.default.error({ jobId: job?.id, err: err.message }, 'Build poll job failed');
    });
    logger_1.default.info('Build poll worker started');
    return worker;
}
//# sourceMappingURL=buildPollWorker.js.map