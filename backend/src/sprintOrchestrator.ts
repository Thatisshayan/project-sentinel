import { safeFire, fireAndForget } from './utils/safeFire';
import logger from './logger';
import { sendTelegramMessage } from './telegramClient';
import { executeBatch } from './taskBuilder';
import { createPullRequest } from './prCreator';
import { findNotionProject } from './notionClient';
import { recordWeeklyVelocity, getVelocityReport } from './velocityTracker';
import {
  getCurrentSprint, getSprintById, updateSprint,
  getNextSprintTask, updateSprintTask, getSprintTasks,
} from './sprintDb';
import { updateAuditTask } from './auditDb';
import { updateNotionTaskStatus } from './auditTaskWriter';
import { enqueueScheduledJob } from './queueClient';
import { SPRINT_CONTINUE_JOB } from './workers/scheduledJobsWorker';

const SPRINT_CONTINUE_DELAY_MS = 10000;

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

async function executeNextSprintTask(sprintId: number, topicId: number | null): Promise<void> {
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

    if (!prUrl) {
      // createPullRequest() swallows its own errors and returns prUrl: null
      // on failure (rate limit, auth hiccup, transient GitHub 5xx) instead
      // of throwing. Marking the task 'done' here would be worse than the
      // equivalent auditOrchestrator.ts gap (fixed alongside this) — 'done'
      // is terminal, so this sprint task would be silently counted as
      // shipped forever even though nothing merge-able was ever produced.
      // The commit is real and pushed to batchResult.taskBranch, so treat
      // this the same way the batchResult.status !== 'completed' branch
      // below treats any other task failure: mark failed, pause the sprint
      // (not just skip ahead — /sentinel resume-sprint is the deliberate
      // human checkpoint), and don't fall through to scheduling the next
      // task automatically.
      logger.error({ repoFullName: task.repo_full_name, taskBranch: batchResult.taskBranch, taskId: task.id },
        'PR creation failed after a completed sprint task — branch pushed, no PR opened');
      const failureReason = `Commit succeeded but PR creation failed — branch pushed: ${batchResult.taskBranch}. Open a PR manually.`;
      await updateSprintTask(task.id, { status: 'failed', failure_reason: failureReason });

      // Sync the linked audit task the same way the success path below
      // does — without this, a sprint task created from an audit task
      // would leave that audit task at 'queued' (or whatever it was
      // before), eligible to be picked up and re-executed by audit
      // execution even though a branch/commit was already pushed for it.
      if (task.audit_task_id) {
        await updateAuditTask(task.audit_task_id, {
          status:         'failed',
          branch_name:    batchResult.taskBranch,
          commit_sha:     batchResult.commitSha,
          commit_url:     batchResult.commitUrl,
          failure_reason: failureReason,
        }).catch((err: any) => {
          logger.warn({ err: err.message, auditTaskId: task.audit_task_id }, 'Failed to sync audit task after PR-creation failure');
          return null;
        });
      }

      const freshSprintOnPrFailure = await getSprintById(sprintId);
      if (!freshSprintOnPrFailure) {
        logger.error({ sprintId, taskId: task.id }, 'Sprint row missing when recording PR-creation failure — pausing without a counter update');
        await updateSprint(sprintId, { status: 'paused' });
      } else {
        await updateSprint(sprintId, {
          status:       'paused',
          failed_tasks: freshSprintOnPrFailure.failed_tasks + 1,
        });
      }

      await safeFire(sendTelegramMessage([
        `Sprint Paused ⏸️ — PR Creation Failed`,
        ``,
        `Task ${task.execution_order}/${sprint.total_tasks} — ${task.task_title}`,
        `Repo: ${task.repo_name}`,
        `Commit succeeded, but opening a PR failed — check GitHub API status/rate limits.`,
        `Branch: ${batchResult.taskBranch}`,
        ``,
        `Open a PR manually from that branch, then:`,
        `/sentinel resume-sprint  — skip this task and continue`,
        `/sentinel skip-sprint    — abandon this sprint`,
      ].join('\n'), task.repo_name, topicId), { label: 'sprintOrchestrator' })
      return;
    }

    await updateSprintTask(task.id, {
      status:       'done',
      pr_url:       prUrl,
      completed_at: new Date().toISOString(),
    });

    // Sync with audit task if this sprint task was created from an audit task
    if (task.audit_task_id) {
      const updatedAuditTask = await updateAuditTask(task.audit_task_id, {
        status: 'build_check',
        branch_name: batchResult.taskBranch,
        commit_sha: batchResult.commitSha,
        commit_url: batchResult.commitUrl,
        pr_url: prUrl,
        pr_number: prUrl ? parseInt(prUrl.split('/').pop() as string) : null,
      }).catch((err: any) => {
        logger.warn({ err: err.message, auditTaskId: task.audit_task_id }, 'Failed to sync audit task');
        return null;
      });
      if (updatedAuditTask?.id) {
        await safeFire(updateNotionTaskStatus(updatedAuditTask.id, 'build_check', { prUrl, commitUrl: batchResult.commitUrl }), { label: 'sprintOrchestrator', retryable: true })
      }
    }

    const freshSprint = await getSprintById(sprintId);
    if (!freshSprint) {
      // Sprint row vanished between the top-of-function fetch and here —
      // extremely unlikely (no code path deletes sprints mid-execution),
      // but silently defaulting to 0 would understate completed_tasks
      // instead of surfacing that something deleted the sprint underneath us.
      logger.error({ sprintId, taskId: task.id }, 'Sprint row missing when recording task completion — skipping counter update');
    } else {
      await updateSprint(sprintId, {
        completed_tasks: freshSprint.completed_tasks + 1,
      });
    }

    await safeFire(sendTelegramMessage([
      `Sprint Task ${task.execution_order}/${sprint.total_tasks} Done ✅`,
      ``,
      `Repo: ${task.repo_name}`,
      `Task: ${task.task_title}`,
      prUrl ? `PR: ${prUrl}` : '',
      ``,
      `${sprint.total_tasks - task.execution_order} tasks remaining this sprint.`,
    ].filter(Boolean).join('\n'), task.repo_name, topicId), { label: 'sprintOrchestrator' })

    // Continue to next task after a brief pause. Persisted via BullMQ rather
    // than a bare setTimeout — a bare timer is lost on process restart
    // (which this system triggers on its own PR merges), silently stranding
    // the sprint in 'executing' with remaining tasks that never run.
    //
    // jobId MUST be unique per scheduling attempt, not per sprint: BullMQ's
    // add() with a jobId that already exists (even completed) returns the
    // existing job instead of creating a new delayed one. A jobId keyed only
    // on sprintId would let the very first continuation schedule correctly,
    // then silently no-op on every task after that — the sprint would stall
    // after task 2. Keying on the just-completed task's id keeps each
    // scheduling attempt distinct while still being deterministic/traceable.
    // Caught (not thrown) deliberately: this function can itself be invoked
    // as a BullMQ job handler for a prior SPRINT_CONTINUE_JOB, and letting an
    // enqueue failure propagate would make BullMQ retry the whole function
    // from the top — re-fetching the "next" task and re-sending the
    // "task done" notification a second time, neither of which is
    // idempotent. A full recovery workflow is out of scope here; at
    // minimum, make the failure visible so a human knows the sprint has
    // silently stalled instead of a debug-only log line.
    await enqueueScheduledJob(
      SPRINT_CONTINUE_JOB,
      { sprintId, topicId },
      SPRINT_CONTINUE_DELAY_MS,
      `sprint-continue:${sprintId}:${task.id}`
    ).catch((err: any) => {
      logger.error({ err: err.message, sprintId, taskId: task.id }, 'Failed to schedule sprint continuation — sprint has stalled');
      return fireAndForget(sendTelegramMessage(
        `⚠️ Project Sentinel — could not schedule the next sprint task (sprint ${sprintId}). Run /sentinel run-sprint to resume manually.`,
        null, topicId
      ), { label: 'sprintOrchestrator' });
    });

  } else {
    const reason = batchResult.reason || 'Unknown failure';

    await updateSprintTask(task.id, {
      status:         'failed',
      failure_reason: reason.substring(0, 500),
    });

    const freshSprint = await getSprintById(sprintId);
    if (!freshSprint) {
      logger.error({ sprintId, taskId: task.id }, 'Sprint row missing when recording task failure — pausing without a counter update');
      await updateSprint(sprintId, { status: 'paused' });
    } else {
      await updateSprint(sprintId, {
        status:       'paused',
        failed_tasks: freshSprint.failed_tasks + 1,
      });
    }

    await safeFire(sendTelegramMessage([
      `Sprint Paused ⏸️`,
      ``,
      `Task ${task.execution_order}/${sprint.total_tasks} failed: ${task.task_title}`,
      `Repo: ${task.repo_name}`,
      `Reason: ${reason.substring(0, 200)}`,
      ``,
      `/sentinel resume-sprint  — skip failed task and continue`,
      `/sentinel skip-sprint    — abandon this sprint`,
    ].join('\n'), task.repo_name, topicId), { label: 'sprintOrchestrator' })
  }
}

// ── Complete ──────────────────────────────────────────────────────────────────

async function completeSprint(sprintId: number, topicId: number | null): Promise<void> {
  const sprint = await getSprintById(sprintId);
  if (!sprint) {
    // Same not-actually-happens-in-practice guard as executeNextSprintTask's
    // freshSprint checks — log loudly and abort rather than send a
    // "Sprint Complete" notification for a sprint that no longer exists.
    logger.error({ sprintId }, 'Sprint row missing at completion — aborting completeSprint, no notification sent');
    return;
  }
  const tasks  = await getSprintTasks(sprintId);

  const done    = tasks.filter((t) => t.status === 'done').length;
  const failed  = tasks.filter((t) => t.status === 'failed').length;
  const skipped = tasks.filter((t) => t.status === 'skipped').length;

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
  const done    = tasks.filter((t) => t.status === 'done').length;
  const pending = tasks.filter((t) => t.status === 'queued').length;
  const inProg  = tasks.filter((t) => t.status === 'in_progress').length;

  const STATUS_EMOJI: Record<string, string> = { done: '✅', in_progress: '🔄', queued: '⏳', failed: '❌', skipped: '⏭️' };
  const taskLines = tasks.slice(0, 10).map((t) =>
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
  const failed = tasks.find((t) => t.status === 'failed');
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

