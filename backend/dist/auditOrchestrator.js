"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const safeFire_1 = require("./utils/safeFire");
const logger_1 = __importDefault(require("./logger"));
const claudeCodeAudit_1 = require("./claudeCodeAudit");
const auditTaskWriter_1 = require("./auditTaskWriter");
const taskBuilder_1 = require("./taskBuilder");
const prCreator_1 = require("./prCreator");
const telegramClient_1 = require("./telegramClient");
const notionClient_1 = require("./notionClient");
const auditDb_1 = require("./auditDb");
const builderRouter_1 = require("./builderRouter");
const selfHealer_1 = require("./selfHealer");
const performanceTracker_1 = require("./performanceTracker");
const repoLock_1 = require("./repoLock");
const settingsLoader_1 = require("./settingsLoader");
const dbClient_1 = __importDefault(require("./dbClient"));
const AUDIT_ENABLED = () => process.env['AUDIT_AGENT_ENABLED'] !== 'false';
const BUILDER_ENABLED = () => process.env['BUILDER_AGENT_ENABLED'] !== 'false';
let getEffectiveBatchSize, getEffectiveDailyLimit;
try {
    ({ getEffectiveBatchSize, getEffectiveDailyLimit } = require('./selfScaler'));
}
catch {
    getEffectiveBatchSize = () => parseInt(process.env['TASK_BATCH_SIZE'] || '5');
    getEffectiveDailyLimit = () => parseInt(process.env['MAX_BUILDER_TASKS_PER_DAY'] || '10');
}
const BATCH_SIZE = () => getEffectiveBatchSize();
const DAILY_LIMIT = () => getEffectiveDailyLimit();
const COOLDOWN_HOURS = async () => {
    const settings = await (0, settingsLoader_1.loadSettings)();
    return settings.audit_cooldown_h;
};
const QUEUED_THRESHOLD = () => parseInt(process.env['MIN_QUEUED_BEFORE_SKIP_AUDIT'] || '3');
const APPROVAL_TIMEOUT_H = () => parseInt(process.env['AUDIT_APPROVAL_TIMEOUT_H'] || '24');
// ── THE 4 LOOP-PREVENTION RULES ───────────────────────────────────────────────
async function checkAuditRules(data) {
    const { repoFullName, repoName, authorName, authorEmail, branchName, commitMessage, topicId } = data;
    // RULE 1 — Skip Sentinel-authored commits
    const isSentinel = [
        authorName === 'Project Sentinel',
        authorEmail === 'sentinel@project-sentinel.app',
        (branchName || '').startsWith('sentinel/'),
        (commitMessage || '').startsWith('feat(sentinel):'),
        (commitMessage || '').startsWith('fix(sentinel):'),
    ].some(Boolean);
    if (isSentinel) {
        logger_1.default.info({ repoName, authorName }, 'Rule 1: Sentinel commit — audit skipped');
        return { pass: false, reason: 'sentinel_commit' };
    }
    // RULE 2 — Skip if queued tasks already exist
    const queuedCount = await (0, auditDb_1.getQueuedTaskCount)(repoFullName);
    if (queuedCount >= QUEUED_THRESHOLD()) {
        logger_1.default.info({ repoName, queuedCount }, 'Rule 2: Tasks queued — audit skipped');
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)(`Project Sentinel — Audit Skipped ⏭️\n\nRepo: ${repoName}\n${queuedCount} tasks still in queue.\nAudit will run when queue clears.`, null, topicId), { label: 'auditOrchestrator' });
        return { pass: false, reason: 'tasks_queued' };
    }
    // RULE 3 — 12-hour cooldown (max 2 audits per day)
    const lastAudit = await (0, auditDb_1.getLastCompletedAudit)(repoFullName);
    if (lastAudit) {
        const hoursSince = (Date.now() - new Date(lastAudit.created_at).getTime()) / 3600000;
        const cooldownHours = await COOLDOWN_HOURS();
        if (hoursSince < cooldownHours) {
            logger_1.default.info({ repoName, hoursSince: Math.round(hoursSince), cooldownHours }, 'Rule 3: Cooldown active — audit skipped');
            return { pass: false, reason: 'cooldown' };
        }
    }
    return { pass: true };
}
// ── MAIN AUDIT TRIGGER ────────────────────────────────────────────────────────
async function triggerAudit(payload) {
    if (!AUDIT_ENABLED()) {
        logger_1.default.info('Audit disabled via AUDIT_AGENT_ENABLED=false');
        return;
    }
    const { repoFullName, repoName, projectName, commitSha, commitMessage, branchName, authorName, authorEmail, topicId, } = payload;
    if (!commitSha || !repoFullName)
        return;
    // Phase 10 — repo lock guard
    const lock = await (0, repoLock_1.isRepoLocked)(repoName).catch(() => null);
    if (lock) {
        logger_1.default.info({ repoName, reason: lock.reason }, 'Repo locked — audit skipped');
        return;
    }
    // Skip explicit opt-out prefixes
    const SKIP = ['[skip-audit]', '[no-audit]', 'chore:', 'docs:'];
    if (SKIP.some(p => (commitMessage || '').startsWith(p))) {
        logger_1.default.info({ repoName }, 'Audit skipped via commit message flag');
        return;
    }
    // Run all 4 rules
    const check = await checkAuditRules({
        repoFullName, repoName, authorName, authorEmail,
        branchName, commitMessage, topicId,
    });
    if (!check.pass)
        return;
    // Prevent duplicate cycles
    const active = await (0, auditDb_1.getActiveCycleForRepo)(repoFullName);
    if (active) {
        logger_1.default.info({ repoFullName, cycleId: active.id }, 'Audit already active');
        return;
    }
    const cycle = await (0, auditDb_1.createAuditCycle)({ repoFullName, commitSha, projectName });
    if (!cycle) {
        logger_1.default.warn({ repoFullName }, 'Could not create audit cycle');
        return;
    }
    logger_1.default.info({ repoFullName, cycleId: cycle.id }, 'Audit cycle started');
    // Get builder assignment from Notion
    let builderAgent = 'qwen_coder';
    try {
        const project = await (0, notionClient_1.findNotionProject)(repoName);
        builderAgent = project?.builderAgent || 'qwen_coder';
    }
    catch (e) {
        logger_1.default.warn({ err: e.message }, 'Could not read builder from Notion — using qwen_coder');
    }
    const builderConfig = (0, builderRouter_1.getBuilderConfig)(builderAgent);
    await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)(`Project Sentinel — Audit Starting 🔍\n\nRepo: ${repoName}\nAnalyst: Claude Code\nBuilder assigned: ${builderConfig.label}`, null, topicId), { label: 'auditOrchestrator' });
    // Run Claude Code audit — wrapped for performance tracking and self-healing
    let auditResult;
    try {
        auditResult = await (0, performanceTracker_1.trackModelCall)(process.env['AUDIT_MODEL'] || 'nvidia', 'audit', 'medium', () => (0, claudeCodeAudit_1.runAudit)({
            repoFullName, repoName, projectName,
            commitSha, branchName: branchName || 'main',
        }));
        await (0, selfHealer_1.reportSuccess)('auditOrchestrator');
    }
    catch (err) {
        await (0, selfHealer_1.reportFailure)('auditOrchestrator', err);
        logger_1.default.error({ err: err.stack ?? err.message, repoFullName }, 'Audit failed');
        await (0, auditDb_1.updateAuditCycle)(cycle.id, { status: 'failed' });
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)(`Project Sentinel — Audit Failed ❌\n\nRepo: ${repoName}\nError: ${err.message.substring(0, 300)}`, null, topicId), { label: 'auditOrchestrator' });
        return;
    }
    // Write tasks to Notion and PostgreSQL
    const notionProject = await (0, notionClient_1.findNotionProject)(repoName).catch(() => null);
    const writeResult = await (0, auditTaskWriter_1.writeTasksToNotion)(auditResult, cycle.id, {
        repoFullName, repoName, projectName, commitSha,
        notionParentPageId: notionProject?.pageId || null,
        builderAgent,
    });
    const safeCount = auditResult.tasks.filter((t) => t.safeToAutoExecute).length;
    const totalCount = auditResult.tasks.length;
    const batchCount = Math.ceil(safeCount / BATCH_SIZE());
    await (0, auditDb_1.updateAuditCycle)(cycle.id, {
        status: 'awaiting_approval',
        health_score: auditResult.overallHealthScore,
        audit_summary: auditResult.auditSummary,
        tasks_total: totalCount,
        tasks_safe: safeCount,
        approval_sent_at: new Date().toISOString(),
    });
    const EMOJI = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
    const taskLines = auditResult.tasks.map((t) => `${t.taskNumber}. ${EMOJI[t.priority] || '⚪'} ${t.title}${t.safeToAutoExecute ? '' : ' 🔒'}`).join('\n');
    const failNote = writeResult.failed.length > 0
        ? `\n⚠️ ${writeResult.failed.length} task(s) failed to write to Notion` : '';
    const skipNote = writeResult.skipped.length > 0
        ? `\n⚠️ ${writeResult.skipped.length} duplicate(s) skipped` : '';
    const auditText = [
        `Project Sentinel — Audit Complete 🔍`,
        ``,
        `Project: ${projectName || repoName}`,
        `Repo: ${repoName}`,
        `Commit: ${commitSha.substring(0, 7)}`,
        `Health Score: ${auditResult.overallHealthScore}/10`,
        `Builder: ${builderConfig.label}`,
        ``,
        auditResult.auditSummary,
        ``,
        `${totalCount} tasks generated:`,
        taskLines,
        ``,
        `🔓 Safe to auto-execute: ${safeCount} (${batchCount} batch${batchCount !== 1 ? 'es' : ''} of ${BATCH_SIZE()})`,
        `🔒 Needs manual review: ${totalCount - safeCount}`,
        failNote, skipNote,
        notionProject ? `\nNotion: ${notionProject.url}` : '',
    ].filter(l => l !== null).join('\n');
    // Send with inline approval buttons
    try {
        const { sendMenu } = require('./telegramMenus');
        const chatId = process.env['TELEGRAM_CHAT_ID'];
        await sendMenu(chatId, topicId, auditText, [
            [
                { text: `✅ Execute ${safeCount} safe tasks`, callback_data: `execute:${repoName}` },
                { text: `⏭ Skip`, callback_data: `skip:${repoName}` },
            ],
        ]);
    }
    catch {
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)(auditText, null, topicId), { label: 'auditOrchestrator' });
    }
    scheduleApprovalTimeout(cycle.id, repoFullName, repoName, topicId);
    logger_1.default.info({ repoFullName, cycleId: cycle.id, tasks: totalCount, safe: safeCount,
        batches: batchCount }, 'Audit complete — awaiting approval');
}
// ── EXECUTE APPROVED TASKS ────────────────────────────────────────────────────
async function executeApprovedTasks(repoFullName, repoName, topicId) {
    if (!BUILDER_ENABLED()) {
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)(`Builder disabled (BUILDER_AGENT_ENABLED=false). Enable in Railway.`, null, topicId), { label: 'auditOrchestrator' });
        return;
    }
    let active = await (0, auditDb_1.getActiveCycleForRepo)(repoFullName);
    if (!active) {
        // No active cycle — check if there are any queued tasks we can still run
        const { query } = require('./dbClient');
        const queued = await query(`
      SELECT COUNT(*) as count FROM audit_tasks
      WHERE repo_full_name = $1 AND status = 'queued'
    `, [repoFullName]).catch(() => null);
        const queuedCount = parseInt(queued?.rows?.[0]?.count || '0');
        if (queuedCount === 0) {
            await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)([
                `No queued tasks for ${repoName}.`,
                `Run /sentinel audit ${repoName} to generate tasks first.`,
            ].join('\n'), null, topicId), { label: 'auditOrchestrator' });
            return;
        }
        // Tasks exist but no active cycle — create a synthetic one so execution can proceed
        const { createAuditCycle } = require('./auditDb');
        active = await createAuditCycle({
            repoFullName,
            commitSha: `manual-execute-${Date.now()}`,
            projectName: repoName,
        }).catch(() => null);
        if (!active) {
            await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)(`Could not start execution cycle for ${repoName}. Try /sentinel audit ${repoName} first.`, null, topicId), { label: 'auditOrchestrator' });
            return;
        }
    }
    await (0, auditDb_1.updateAuditCycle)(active.id, {
        status: 'executing', approved_at: new Date().toISOString(),
    });
    logger_1.default.info({ repoFullName, cycleId: active.id }, 'Task execution approved');
    await processNextBatch(repoFullName, repoName, topicId);
}
async function processNextBatch(repoFullName, repoName, topicId) {
    const todayCount = await (0, auditDb_1.countTasksExecutedToday)(repoFullName);
    if (todayCount >= DAILY_LIMIT()) {
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)(`Project Sentinel — Daily Limit ⏸️\n\nRepo: ${repoName}\nTasks today: ${todayCount}/${DAILY_LIMIT()}\nContinuing tomorrow.`, null, topicId), { label: 'auditOrchestrator' });
        return;
    }
    const tasks = await (0, auditDb_1.getNextBatch)(repoFullName, BATCH_SIZE());
    if (tasks.length === 0) {
        const cycle = await (0, auditDb_1.getActiveCycleForRepo)(repoFullName);
        if (cycle)
            await (0, auditDb_1.updateAuditCycle)(cycle.id, { status: 'complete' });
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)([
            `Project Sentinel — All Safe Tasks Complete ✅`,
            ``,
            `Repo: ${repoName}`,
            `Unsafe tasks remain in Notion for manual review.`,
            `Next audit available in ${COOLDOWN_HOURS()}h after next human commit.`,
        ].join('\n'), null, topicId), { label: 'auditOrchestrator' });
        return;
    }
    for (const task of tasks) {
        await (0, auditDb_1.updateAuditTask)(task.id, { status: 'in_progress' });
        await (0, auditTaskWriter_1.updateNotionTaskStatus)(task.notion_page_id, 'in_progress');
    }
    const builderConfig = (0, builderRouter_1.getBuilderConfig)(tasks[0].builder_agent || 'qwen_coder');
    const batchNum = tasks[0].batch_number;
    const taskTitles = tasks.map((t) => `${t.task_number}. ${t.title}`).join('\n');
    await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)([
        `Project Sentinel — Executing Batch ${batchNum} 🔨`,
        ``,
        `Repo: ${repoName}`,
        `Tasks: ${tasks.length}`,
        `Builder: ${builderConfig.label}`,
        ``,
        taskTitles,
    ].join('\n'), null, topicId), { label: 'auditOrchestrator' });
    const notionProject = await (0, notionClient_1.findNotionProject)(repoName).catch(() => null);
    const primaryBuilder = tasks[0].builder_agent || 'qwen_coder';
    let batchResult = await (0, taskBuilder_1.executeBatch)(tasks, {
        repoFullName, repoName,
        projectName: notionProject?.projectName || repoName,
        branchName: 'main',
        topicId,
    }, primaryBuilder);
    // T10 — retry with fallback builder on failure (once)
    if (batchResult.status !== 'completed') {
        const fallback = (0, builderRouter_1.getFallbackBuilder)(primaryBuilder);
        if (fallback) {
            logger_1.default.info({ primaryBuilder, fallback, repoFullName }, 'Primary builder failed — retrying with fallback');
            await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)(`Builder ${primaryBuilder} failed for ${repoName}. Retrying with ${fallback}...`, null, topicId), { label: 'auditOrchestrator' });
            batchResult = await (0, taskBuilder_1.executeBatch)(tasks, {
                repoFullName, repoName,
                projectName: notionProject?.projectName || repoName,
                branchName: 'main',
                topicId,
            }, fallback);
        }
    }
    if (batchResult.status === 'completed') {
        const completedNums = batchResult.completedTasks.map((t) => t.task_number).join(', ');
        const { prUrl, prNumber } = await (0, prCreator_1.createPullRequest)({
            repoFullName,
            fixBranch: batchResult.taskBranch,
            baseBranch: 'main',
            context: {
                projectName: notionProject?.projectName || repoName,
                repoName, commitSha: batchResult.commitSha,
                attemptNumber: batchNum,
                buildProvider: 'sentinel-tasks',
                failureReason: `Sentinel improvement batch ${batchNum} — tasks ${completedNums}`,
                kind: 'task',
            },
        });
        for (const task of batchResult.completedTasks) {
            await (0, auditDb_1.updateAuditTask)(task.id, {
                status: 'build_check', branch_name: batchResult.taskBranch,
                commit_sha: batchResult.commitSha, commit_url: batchResult.commitUrl,
                pr_url: prUrl, pr_number: prNumber,
            });
            await (0, auditTaskWriter_1.updateNotionTaskStatus)(task.notion_page_id, 'build_check', {
                prUrl, commitUrl: batchResult.commitUrl,
            });
        }
        const skipped = tasks.filter((t) => !batchResult.completedTasks.find((ct) => ct.id === t.id));
        for (const task of skipped) {
            await (0, auditDb_1.updateAuditTask)(task.id, { status: 'queued' });
            await (0, auditTaskWriter_1.updateNotionTaskStatus)(task.notion_page_id, 'queued');
        }
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)([
            `Project Sentinel — Batch ${batchNum} Ready ✅`,
            ``,
            `Repo: ${repoName}`,
            `Tasks completed: ${batchResult.completedTasks.length}/${tasks.length}`,
            `Builder: ${batchResult.builderUsed}`,
            ``,
            prUrl ? `PR: ${prUrl}` : '',
            ``,
            batchResult.remainingTasks > 0
                ? `Merge to continue. ${batchResult.remainingTasks} tasks remain.`
                : `Merge to finish. This is the final batch.`,
        ].filter(Boolean).join('\n'), null, topicId), { label: 'auditOrchestrator' });
    }
    else {
        // Re-queue all tasks so they can be retried — the builder failed (infra/API/aider),
        // not the tasks themselves. Marking them failed would silently destroy the queue.
        for (const task of tasks) {
            await (0, auditDb_1.updateAuditTask)(task.id, { status: 'queued', failure_reason: null });
            await (0, safeFire_1.safeFire)((0, auditTaskWriter_1.updateNotionTaskStatus)(task.notion_page_id, 'queued'), { label: 'auditOrchestrator' });
        }
        // Show stdout (aider conversation) and stderr (errors/warnings) separately
        // so we can see both what the model did and what errors occurred.
        const stdoutTail = (batchResult.lastStdout || '').slice(-600);
        const stderrTail = (batchResult.lastStderr || '').slice(-400);
        const errDetail = [
            stderrTail ? `stderr:\n${stderrTail}` : '',
            stdoutTail ? `stdout:\n${stdoutTail}` : '',
        ].filter(Boolean).join('\n\n').slice(-1000);
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)([
            `Project Sentinel — Batch ${batchNum} Failed ❌`,
            ``,
            `Repo: ${repoName}`,
            `Reason: ${batchResult.reason || 'Unknown'}`,
            errDetail ? `\nBuilder output:\n${errDetail}` : '',
            ``,
            `Tasks re-queued. /sentinel execute ${repoName} to retry.`,
        ].filter(Boolean).join('\n'), null, topicId), { label: 'auditOrchestrator' });
        // Also log to agent_messages so it's visible in the UI without Telegram
        const { logAgentMessage } = require('./agentDb');
        await (0, safeFire_1.safeFire)(logAgentMessage('sentinel', 'Sentinel', `Batch ${batchNum} failed for ${repoName}. Reason: ${batchResult.reason || 'Unknown'}${errDetail ? '\n\nBuilder output:\n' + errDetail : ''}`, 'error', repoName), { label: 'auditOrchestrator' });
    }
}
// ── CALLED WHEN BUILD PASSES AFTER SENTINEL PR IS MERGED ─────────────────────
async function handleBuildPassedAfterSentinelMerge(repoFullName, repoName, branchName, topicId) {
    await (0, auditDb_1.markTasksDoneForBranch)(repoFullName, branchName);
    // Always delegate to processNextBatch — it correctly marks the cycle
    // complete and notifies the user even when zero tasks remain.
    await processNextBatch(repoFullName, repoName, topicId);
}
// ── APPROVAL TIMEOUT ──────────────────────────────────────────────────────────
function scheduleApprovalTimeout(cycleId, repoFullName, repoName, topicId) {
    setTimeout(async () => {
        try {
            const { query } = dbClient_1.default;
            const r = await query('SELECT * FROM audit_cycles WHERE id=$1 AND status=$2', [cycleId, 'awaiting_approval']);
            if (r.rows.length === 0)
                return;
            await (0, auditDb_1.updateAuditCycle)(cycleId, { status: 'skipped' });
            await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)(`Project Sentinel — Audit Expired ⏱️\n\nRepo: ${repoName}\nNo response in ${APPROVAL_TIMEOUT_H()}h.\nTasks remain in Notion as Queued.\n/sentinel audit ${repoName} to re-audit.`, null, topicId), { label: 'auditOrchestrator' });
        }
        catch (err) {
            logger_1.default.warn({ err: err.message }, 'Approval timeout handler error');
        }
    }, APPROVAL_TIMEOUT_H() * 60 * 60 * 1000);
}
module.exports = {
    triggerAudit,
    executeApprovedTasks,
    processNextBatch,
    handleBuildPassedAfterSentinelMerge,
};
//# sourceMappingURL=auditOrchestrator.js.map