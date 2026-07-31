import logger from './logger';
import { checkDuplicateTask, createAuditTask, updateAuditTask } from './auditDb';
import type { AuditResult } from './types/auditResult';

/**
 * D-025 (docs/governance/DEFERRED_WORK.md): decoupled from the real Notion
 * API. audit_tasks in Postgres was already the source of truth (taskBuilder.ts,
 * sprintOrchestrator.ts etc. all read/write it directly) — the Notion page
 * per task was a redundant mirror. Function names kept as-is so callers
 * (auditOrchestrator.ts, selfAuditor.ts, sprintOrchestrator.ts,
 * processPREvent.ts) needed minimal changes: pass the Postgres task id
 * (task.id) where they used to pass task.notion_page_id.
 */

interface WrittenTask { taskNumber: number; title: string; taskId: number | null; }
interface SkippedTask { taskNumber: number; title: string; }
interface FailedTask { taskNumber: number; title: string; reason: string; }
interface WriteTasksResult { written: WrittenTask[]; skipped: SkippedTask[]; failed: FailedTask[]; }

interface WriteTasksPayload {
  repoFullName: string;
  repoName?: string;
  projectName?: string;
  commitSha?: string;
  notionParentPageId?: string | null;
  builderAgent?: string;
  source?: string;
}

async function writeTasksToNotion(auditResult: AuditResult, auditCycleId: number, payload: WriteTasksPayload): Promise<WriteTasksResult> {
  const { repoFullName, builderAgent } = payload;

  const written: WrittenTask[] = [];
  const skipped: SkippedTask[] = [];
  const failed: FailedTask[]  = [];

  const batchSize = parseInt(process.env['TASK_BATCH_SIZE'] || '5');

  for (const task of auditResult.tasks) {
    const batchNumber = Math.ceil(task.taskNumber / batchSize);

    const isDuplicate = await checkDuplicateTask(repoFullName, task.title);
    if (isDuplicate) {
      skipped.push({ taskNumber: task.taskNumber, title: task.title });
      logger.info({ title: task.title }, 'Skipping duplicate task');
      continue;
    }

    try {
      const row = await createAuditTask({
        auditCycleId,
        repoFullName,
        taskNumber:          task.taskNumber,
        title:               task.title,
        description:         task.description,
        priority:            task.priority,
        category:            task.category,
        affectedFiles:       task.affectedFiles,
        complexity:          task.estimatedComplexity,
        safeToAutoExecute:   task.safeToAutoExecute,
        safetyReason:        task.safetyReason,
        acceptanceCriteria:  task.acceptanceCriteria,
        batchNumber,
        builderAgent:        builderAgent || 'nvidia',
      });
      written.push({ taskNumber: task.taskNumber, title: task.title, taskId: row?.id ?? null });
    } catch (err: any) {
      logger.error({ taskNumber: task.taskNumber, err: err.message },
        'Failed to save task to database');
      failed.push({ taskNumber: task.taskNumber, title: task.title, reason: err.message });
    }
  }

  return { written, skipped, failed };
}

interface UpdateTaskExtra {
  prUrl?: string | null;
  commitUrl?: string | null;
  failureReason?: string;
}

async function updateNotionTaskStatus(taskId: number | null, status: string, extra: UpdateTaskExtra = {}): Promise<void> {
  if (!taskId) return;
  try {
    const updates: Record<string, unknown> = { status };
    if (extra.prUrl)         updates['pr_url']         = extra.prUrl;
    if (extra.commitUrl)     updates['commit_url']     = extra.commitUrl;
    if (extra.failureReason) updates['failure_reason'] = extra.failureReason.substring(0, 500);
    await updateAuditTask(taskId, updates);
  } catch (err: any) {
    logger.warn({ err: err.message, taskId }, 'Could not update task status');
  }
}

export = { writeTasksToNotion, updateNotionTaskStatus };
