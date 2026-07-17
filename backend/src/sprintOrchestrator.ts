import { safeFire, fireAndForget } from './utils/safeFire';
import logger from './logger';
const { sendTelegramMessage }  = require('./telegramClient');
const { executeBatch }         = require('./taskBuilder');
const { createPullRequest }    = require('./prCreator');
const { findNotionProject }    = require('./notionClient');
const { recordWeeklyVelocity,
        getVelocityReport }    = require('./velocityTracker');
const {
  getCurrentSprint, getSprintById, updateSprint,
  getNextSprintTask, updateSprintTask, getSprintTasks,
} = require('./sprintDb');

// ── Approve ───────────────────────────────────────────────────────────────────

async function approveSprint(topicId: number | null): Promise<void> {
  const sprint = await getCurrentSprint();

  if (!sprint) {
    await safeFire(sendTelegramMessage(
      'No sprint proposal found. Sentinel generates one every Sunday at 8pm.',
      null, topicId
    ), { label: 'sprintOrchestrator' })
    return;
  }

  if (sprint.status !== 'proposed') {
    await safeFire(sendTelegramMessage(
      `Sprint is already ${sprint.status}. Use /sentinel sprint-status to check progress.`,
      null, topicId
    ), { label: 'sprintOrchestrator' })
    return;
  }

  await updateSprint(sprint.id, {
    status:      'executing',
    approved_at: new Date().toISOString(),
  });

  await safeFire(sendTelegramMessage([
    `Project Sentinel — Sprint Approved ✅`,
    ``,
    `Week of ${sprint.week_start} — ${sprint.total_tasks} tasks queued`,
    `Starting with highest priority tasks first.`,
    ``,
    `/sentinel sprint-status — check progress anytime`,
    `/sentinel pause-sprint  — pause execution`,
  ].join('\n'), null, topicId), { label: 'sprintOrchestrator' })

  logger.info({ sprintId: sprint.id }, 'Sprint approved — starting execution');
  executeNextSprintTask(sprint.id, topicId).catch((err: any) =>
    logger.error({ err: err.stack ?? err.message }, 'Initial sprint task failed')
  );
}

// ── Task execution loop ───────────────────────────────────────────────────────

async function executeNextSprintTask(sprintId: string, topicId: number | null): Promise<void> {
  const sprint = await getSprintById(sprintId);
  if (!sprint || sprint.status !== 'executing') return;

  const task = await getNextSprintTask(sprintId);

  if (!task) {
    await completeSprint(sprintId, topicId);
    return;
  }

  await updateSprintTask(task.id, {
    status:     'in_progress',
    started_at: new Date().toISOString(),
  });

  logger.info(
    { taskId: task.id, repo: task.repo_name, title: task.task_title, order: task.execution_order },
    'Executing sprint task'
  );

  const notionProject = await findNotionProject(task.repo_name).catch(() => null);

  // Map sprint_task to the shape executeBatch expects
  const batchTask = {
    id:                   task.id,
    task_number:          task.execution_order,
    batch_number:         1,
    title:                task.task_title,
    description:          task.task_description || '',
    affected_files:       [],
    acceptance_criteria:  '',
    priority:             task.priority,
    builder_agent:        task.builder_agent,
  };

  const batchResult = await executeBatch(
    [batchTask],
    {
      repoFullName: task.repo_full_name,
      repoName:     task.repo_name,
      projectName:  notionProject?.projectName || task.repo_name,
      branchName:   'main',
      topicId,
    },
    task.builder_agent
  );

  if (batchResult.status === 'completed') {
    const { prUrl } = await createPullRequest({
      repoFullName: task.repo_full_name,
      fixBranch:    batchResult.taskBranch,
      baseBranch:   'main',
      context: {
        projectName:   notionProject?.projectName || task.repo_name,
        repoName:      task.repo_name,
        commitSha:     batchResult.commitSha || '',
        attemptNumber: task.execution_order,
        buildProvider: 'sprint',
        failureReason: task.task_title,
        kind: 'task',
      },
    });

    await updateSprintTask(task.id, {
      status:       'done',
      pr_url:       prUrl || null,
      completed_at: new Date().toISOString(),
    });

    // Sync with audit task if this sprint task was created from an audit task
    if (task.audit_task_id) {
      const { updateAuditTask, updateNotionTaskStatus } = require('./auditDb');
      await updateAuditTask(task.audit_task_id, {
        status: 'build_check',
        branch_name: batchResult.taskBranch,
        commit_sha: batchResult.commitSha,
        commit_url: batchResult.commitUrl,
        pr_url: prUrl,
        pr_number: prUrl ? parseInt(prUrl.split('/').pop() as string) : null,
      }).catch((err: any) => logger.warn({ err: err.message, auditTaskId: task.audit_task_id }, 'Failed to sync audit task'));
      await safeFire(updateNotionTaskStatus(task.audit_task_id, 'build_check', { prUrl, commitUrl: batchResult.commitUrl }), { label: 'sprintOrchestrator' })
    }

    const freshSprint = await getSprintById(sprintId);
    await updateSprint(sprintId, {
      completed_tasks: (freshSprint.completed_tasks || 0) + 1,
    });

    await safeFire(sendTelegramMessage([
      `Sprint Task ${task.execution_order}/${sprint.total_tasks} Done ✅`,
      ``,
      `Repo: ${task.repo_name}`,
      `Task: ${task.task_title}`,
      prUrl ? `PR: ${prUrl}` : '',
      ``,
      `${sprint.total_tasks - task.execution_order} tasks remaining this sprint.`,
    ].filter(Boolean).join('\n'), null, topicId), { label: 'sprintOrchestrator' })

    // Continue to next task after a brief pause
    setTimeout(() => {
      executeNextSprintTask(sprintId, topicId).catch((err: any) =>
        logger.error({ err: err.stack ?? err.message }, 'Sprint continuation failed')
      );
    }, 10000);

  } else {
    const reason = batchResult.reason || 'Unknown failure';

    await updateSprintTask(task.id, {
      status:         'failed',
      failure_reason: reason.substring(0, 500),
    });

    const freshSprint = await getSprintById(sprintId);
    await updateSprint(sprintId, {
      status:       'paused',
      failed_tasks: (freshSprint.failed_tasks || 0) + 1,
    });

    await safeFire(sendTelegramMessage([
      `Sprint Paused ⏸️`,
      ``,
      `Task ${task.execution_order}/${sprint.total_tasks} failed: ${task.task_title}`,
      `Repo: ${task.repo_name}`,
      `Reason: ${reason.substring(0, 200)}`,
      ``,
      `/sentinel resume-sprint  — skip failed task and continue`,
      `/sentinel skip-sprint    — abandon this sprint`,
    ].join('\n'), null, topicId), { label: 'sprintOrchestrator' })
  }
}

// ── Complete ──────────────────────────────────────────────────────────────────

async function completeSprint(sprintId: string, topicId: number | null): Promise<void> {
  const sprint = await getSprintById(sprintId);
  const tasks  = await getSprintTasks(sprintId);

  const done    = tasks.filter((t: any) => t.status === 'done').length;
  const failed  = tasks.filter((t: any) => t.status === 'failed').length;
  const skipped = tasks.filter((t: any) => t.status === 'skipped').length;

  await updateSprint(sprintId, {
    status:          'complete',
    completed_tasks: done,
    failed_tasks:    failed,
    skipped_tasks:   skipped,
    completed_at:    new Date().toISOString(),
  });

  await recordWeeklyVelocity().catch((err: any) =>
    logger.warn({ err: err.message }, 'Velocity record failed — non-blocking')
  );
  const velocityReport = await getVelocityReport().catch(() => '');

  await safeFire(sendTelegramMessage([
    `Project Sentinel — Sprint Complete 🏁`,
    ``,
    `Week of ${sprint.week_start}`,
    `✅ Done: ${done}  ❌ Failed: ${failed}  ⏭️ Skipped: ${skipped}`,
    ``,
    velocityReport,
    ``,
    `Next sprint proposal arrives Sunday at 8pm.`,
  ].filter(Boolean).join('\n'), null, topicId), { label: 'sprintOrchestrator' })

  logger.info({ sprintId, done, failed, skipped }, 'Sprint complete');
}

// ── Status ────────────────────────────────────────────────────────────────────

async function getSprintStatus(topicId: number | null): Promise<void> {
  const sprint = await getCurrentSprint();

  if (!sprint) {
    await safeFire(sendTelegramMessage(
      'No active sprint. Next proposal: Sunday at 8pm Toronto.',
      null, topicId
    ), { label: 'sprintOrchestrator' })
    return;
  }

  const tasks   = await getSprintTasks(sprint.id);
  const done    = tasks.filter((t: any) => t.status === 'done').length;
  const pending = tasks.filter((t: any) => t.status === 'queued').length;
  const inProg  = tasks.filter((t: any) => t.status === 'in_progress').length;

  const STATUS_EMOJI: Record<string, string> = { done: '✅', in_progress: '🔄', queued: '⏳', failed: '❌', skipped: '⏭️' };
  const taskLines = tasks.slice(0, 10).map((t: any) =>
    `${STATUS_EMOJI[t.status] || '⚪'} ${t.repo_name}: ${t.task_title}`
  ).join('\n');

  await safeFire(sendTelegramMessage([
    `Sprint Status — Week of ${sprint.week_start}`,
    `Status: ${sprint.status}`,
    ``,
    `✅ ${done}/${sprint.total_tasks} done  🔄 ${inProg} running  ⏳ ${pending} queued`,
    ``,
    taskLines,
    tasks.length > 10 ? `...and ${tasks.length - 10} more` : '',
  ].filter(Boolean).join('\n'), null, topicId), { label: 'sprintOrchestrator' })
}

// ── Pause / Resume ────────────────────────────────────────────────────────────

async function pauseSprint(topicId: number | null): Promise<void> {
  const sprint = await getCurrentSprint();
  if (!sprint || sprint.status !== 'executing') {
    await safeFire(sendTelegramMessage('No executing sprint to pause.', null, topicId), { label: 'sprintOrchestrator' })
    return;
  }
  await updateSprint(sprint.id, { status: 'paused' });
  await safeFire(sendTelegramMessage(
    'Sprint paused. Use /sentinel resume-sprint to continue.',
    null, topicId
  ), { label: 'sprintOrchestrator' })
}

async function resumeSprint(topicId: number | null): Promise<void> {
  const sprint = await getCurrentSprint();
  if (!sprint || sprint.status !== 'paused') {
    await safeFire(sendTelegramMessage('No paused sprint to resume.', null, topicId), { label: 'sprintOrchestrator' })
    return;
  }

  // Skip any failed task so we don't retry it
  const tasks  = await getSprintTasks(sprint.id);
  const failed = tasks.find((t: any) => t.status === 'failed');
  if (failed) {
    await updateSprintTask(failed.id, { status: 'skipped' });
  }

  await updateSprint(sprint.id, { status: 'executing' });
  await safeFire(sendTelegramMessage(
    'Sprint resumed — skipping failed task and continuing.',
    null, topicId
  ), { label: 'sprintOrchestrator' })

  executeNextSprintTask(sprint.id, topicId).catch((err: any) =>
    logger.error({ err: err.stack ?? err.message }, 'Sprint resume failed')
  );
}

export = {
  approveSprint,
  executeNextSprintTask,
  getSprintStatus,
  pauseSprint,
  resumeSprint,
};

