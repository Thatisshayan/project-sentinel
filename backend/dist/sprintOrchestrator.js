"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const safeFire_1 = require("./utils/safeFire");
const logger_1 = __importDefault(require("./logger"));
const telegramClient_1 = require("./telegramClient");
const taskBuilder_1 = require("./taskBuilder");
const prCreator_1 = require("./prCreator");
const notionClient_1 = require("./notionClient");
const velocityTracker_1 = require("./velocityTracker");
const sprintDb_1 = require("./sprintDb");
const auditDb_1 = require("./auditDb");
const auditTaskWriter_1 = require("./auditTaskWriter");
// ── Approve ───────────────────────────────────────────────────────────────────
async function approveSprint(topicId) {
    const sprint = await (0, sprintDb_1.getCurrentSprint)();
    if (!sprint) {
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)('No sprint proposal found. Sentinel generates one every Sunday at 8pm.', null, topicId), { label: 'sprintOrchestrator' });
        return;
    }
    if (sprint.status !== 'proposed') {
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)(`Sprint is already ${sprint.status}. Use /sentinel sprint-status to check progress.`, null, topicId), { label: 'sprintOrchestrator' });
        return;
    }
    await (0, sprintDb_1.updateSprint)(sprint.id, {
        status: 'executing',
        approved_at: new Date().toISOString(),
    });
    await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)([
        `Project Sentinel — Sprint Approved ✅`,
        ``,
        `Week of ${sprint.week_start} — ${sprint.total_tasks} tasks queued`,
        `Starting with highest priority tasks first.`,
        ``,
        `/sentinel sprint-status — check progress anytime`,
        `/sentinel pause-sprint  — pause execution`,
    ].join('\n'), null, topicId), { label: 'sprintOrchestrator' });
    logger_1.default.info({ sprintId: sprint.id }, 'Sprint approved — starting execution');
    executeNextSprintTask(sprint.id, topicId).catch((err) => logger_1.default.error({ err: err.stack ?? err.message }, 'Initial sprint task failed'));
}
// ── Task execution loop ───────────────────────────────────────────────────────
async function executeNextSprintTask(sprintId, topicId) {
    const sprint = await (0, sprintDb_1.getSprintById)(sprintId);
    if (!sprint || sprint.status !== 'executing')
        return;
    const task = await (0, sprintDb_1.getNextSprintTask)(sprintId);
    if (!task) {
        await completeSprint(sprintId, topicId);
        return;
    }
    await (0, sprintDb_1.updateSprintTask)(task.id, {
        status: 'in_progress',
        started_at: new Date().toISOString(),
    });
    logger_1.default.info({ taskId: task.id, repo: task.repo_name, title: task.task_title, order: task.execution_order }, 'Executing sprint task');
    const notionProject = await (0, notionClient_1.findNotionProject)(task.repo_name).catch(() => null);
    // Map sprint_task to the shape executeBatch expects
    const batchTask = {
        id: task.id,
        task_number: task.execution_order,
        batch_number: 1,
        title: task.task_title,
        description: task.task_description || '',
        affected_files: [],
        acceptance_criteria: '',
        priority: task.priority,
        builder_agent: task.builder_agent,
    };
    const batchResult = await (0, taskBuilder_1.executeBatch)([batchTask], {
        repoFullName: task.repo_full_name,
        repoName: task.repo_name,
        projectName: notionProject?.projectName || task.repo_name,
        branchName: 'main',
        topicId,
    }, task.builder_agent);
    if (batchResult.status === 'completed') {
        const { prUrl } = await (0, prCreator_1.createPullRequest)({
            repoFullName: task.repo_full_name,
            fixBranch: batchResult.taskBranch,
            baseBranch: 'main',
            context: {
                projectName: notionProject?.projectName || task.repo_name,
                repoName: task.repo_name,
                commitSha: batchResult.commitSha || '',
                attemptNumber: task.execution_order,
                buildProvider: 'sprint',
                failureReason: task.task_title,
                kind: 'task',
            },
        });
        await (0, sprintDb_1.updateSprintTask)(task.id, {
            status: 'done',
            pr_url: prUrl || null,
            completed_at: new Date().toISOString(),
        });
        // Sync with audit task if this sprint task was created from an audit task
        if (task.audit_task_id) {
            await (0, auditDb_1.updateAuditTask)(task.audit_task_id, {
                status: 'build_check',
                branch_name: batchResult.taskBranch,
                commit_sha: batchResult.commitSha,
                commit_url: batchResult.commitUrl,
                pr_url: prUrl,
                pr_number: prUrl ? parseInt(prUrl.split('/').pop()) : null,
            }).catch((err) => logger_1.default.warn({ err: err.message, auditTaskId: task.audit_task_id }, 'Failed to sync audit task'));
            await (0, safeFire_1.safeFire)((0, auditTaskWriter_1.updateNotionTaskStatus)(task.audit_task_id, 'build_check', { prUrl, commitUrl: batchResult.commitUrl }), { label: 'sprintOrchestrator' });
        }
        const freshSprint = await (0, sprintDb_1.getSprintById)(sprintId);
        await (0, sprintDb_1.updateSprint)(sprintId, {
            completed_tasks: (freshSprint.completed_tasks || 0) + 1,
        });
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)([
            `Sprint Task ${task.execution_order}/${sprint.total_tasks} Done ✅`,
            ``,
            `Repo: ${task.repo_name}`,
            `Task: ${task.task_title}`,
            prUrl ? `PR: ${prUrl}` : '',
            ``,
            `${sprint.total_tasks - task.execution_order} tasks remaining this sprint.`,
        ].filter(Boolean).join('\n'), null, topicId), { label: 'sprintOrchestrator' });
        // Continue to next task after a brief pause
        setTimeout(() => {
            executeNextSprintTask(sprintId, topicId).catch((err) => logger_1.default.error({ err: err.stack ?? err.message }, 'Sprint continuation failed'));
        }, 10000);
    }
    else {
        const reason = batchResult.reason || 'Unknown failure';
        await (0, sprintDb_1.updateSprintTask)(task.id, {
            status: 'failed',
            failure_reason: reason.substring(0, 500),
        });
        const freshSprint = await (0, sprintDb_1.getSprintById)(sprintId);
        await (0, sprintDb_1.updateSprint)(sprintId, {
            status: 'paused',
            failed_tasks: (freshSprint.failed_tasks || 0) + 1,
        });
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)([
            `Sprint Paused ⏸️`,
            ``,
            `Task ${task.execution_order}/${sprint.total_tasks} failed: ${task.task_title}`,
            `Repo: ${task.repo_name}`,
            `Reason: ${reason.substring(0, 200)}`,
            ``,
            `/sentinel resume-sprint  — skip failed task and continue`,
            `/sentinel skip-sprint    — abandon this sprint`,
        ].join('\n'), null, topicId), { label: 'sprintOrchestrator' });
    }
}
// ── Complete ──────────────────────────────────────────────────────────────────
async function completeSprint(sprintId, topicId) {
    const sprint = await (0, sprintDb_1.getSprintById)(sprintId);
    const tasks = await (0, sprintDb_1.getSprintTasks)(sprintId);
    const done = tasks.filter((t) => t.status === 'done').length;
    const failed = tasks.filter((t) => t.status === 'failed').length;
    const skipped = tasks.filter((t) => t.status === 'skipped').length;
    await (0, sprintDb_1.updateSprint)(sprintId, {
        status: 'complete',
        completed_tasks: done,
        failed_tasks: failed,
        skipped_tasks: skipped,
        completed_at: new Date().toISOString(),
    });
    await (0, velocityTracker_1.recordWeeklyVelocity)().catch((err) => logger_1.default.warn({ err: err.message }, 'Velocity record failed — non-blocking'));
    const velocityReport = await (0, velocityTracker_1.getVelocityReport)().catch(() => '');
    await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)([
        `Project Sentinel — Sprint Complete 🏁`,
        ``,
        `Week of ${sprint.week_start}`,
        `✅ Done: ${done}  ❌ Failed: ${failed}  ⏭️ Skipped: ${skipped}`,
        ``,
        velocityReport,
        ``,
        `Next sprint proposal arrives Sunday at 8pm.`,
    ].filter(Boolean).join('\n'), null, topicId), { label: 'sprintOrchestrator' });
    logger_1.default.info({ sprintId, done, failed, skipped }, 'Sprint complete');
}
// ── Status ────────────────────────────────────────────────────────────────────
async function getSprintStatus(topicId) {
    const sprint = await (0, sprintDb_1.getCurrentSprint)();
    if (!sprint) {
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)('No active sprint. Next proposal: Sunday at 8pm Toronto.', null, topicId), { label: 'sprintOrchestrator' });
        return;
    }
    const tasks = await (0, sprintDb_1.getSprintTasks)(sprint.id);
    const done = tasks.filter((t) => t.status === 'done').length;
    const pending = tasks.filter((t) => t.status === 'queued').length;
    const inProg = tasks.filter((t) => t.status === 'in_progress').length;
    const STATUS_EMOJI = { done: '✅', in_progress: '🔄', queued: '⏳', failed: '❌', skipped: '⏭️' };
    const taskLines = tasks.slice(0, 10).map((t) => `${STATUS_EMOJI[t.status] || '⚪'} ${t.repo_name}: ${t.task_title}`).join('\n');
    await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)([
        `Sprint Status — Week of ${sprint.week_start}`,
        `Status: ${sprint.status}`,
        ``,
        `✅ ${done}/${sprint.total_tasks} done  🔄 ${inProg} running  ⏳ ${pending} queued`,
        ``,
        taskLines,
        tasks.length > 10 ? `...and ${tasks.length - 10} more` : '',
    ].filter(Boolean).join('\n'), null, topicId), { label: 'sprintOrchestrator' });
}
// ── Pause / Resume ────────────────────────────────────────────────────────────
async function pauseSprint(topicId) {
    const sprint = await (0, sprintDb_1.getCurrentSprint)();
    if (!sprint || sprint.status !== 'executing') {
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)('No executing sprint to pause.', null, topicId), { label: 'sprintOrchestrator' });
        return;
    }
    await (0, sprintDb_1.updateSprint)(sprint.id, { status: 'paused' });
    await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)('Sprint paused. Use /sentinel resume-sprint to continue.', null, topicId), { label: 'sprintOrchestrator' });
}
async function resumeSprint(topicId) {
    const sprint = await (0, sprintDb_1.getCurrentSprint)();
    if (!sprint || sprint.status !== 'paused') {
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)('No paused sprint to resume.', null, topicId), { label: 'sprintOrchestrator' });
        return;
    }
    // Skip any failed task so we don't retry it
    const tasks = await (0, sprintDb_1.getSprintTasks)(sprint.id);
    const failed = tasks.find((t) => t.status === 'failed');
    if (failed) {
        await (0, sprintDb_1.updateSprintTask)(failed.id, { status: 'skipped' });
    }
    await (0, sprintDb_1.updateSprint)(sprint.id, { status: 'executing' });
    await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)('Sprint resumed — skipping failed task and continuing.', null, topicId), { label: 'sprintOrchestrator' });
    executeNextSprintTask(sprint.id, topicId).catch((err) => logger_1.default.error({ err: err.stack ?? err.message }, 'Sprint resume failed'));
}
module.exports = {
    approveSprint,
    executeNextSprintTask,
    getSprintStatus,
    pauseSprint,
    resumeSprint,
};
//# sourceMappingURL=sprintOrchestrator.js.map