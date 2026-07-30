// Shared shapes for taskBuilder.ts's executeBatch() and its per-task
// builder runners (runClaudeCodeForTask in claudeCodeRunner.ts,
// runAiderForTask in taskBuilder.ts itself). Standalone module since
// several of these source files use `export =`.

// The minimal shape executeBatch/runAiderForTask/buildAiderTaskMessage
// actually read — deliberately narrower than the full AuditTaskRow, since
// sprintOrchestrator.ts calls executeBatch with a synthetic task object
// built from a sprint_tasks row (a different table), not a real
// audit_tasks row. AuditTaskRow satisfies this structurally.
export interface BuildableTask {
  id: number;
  task_number: number;
  batch_number: number | null;
  title: string;
  description: string | null;
  affected_files: string[] | null;
  acceptance_criteria: string | null;
  priority: string;
  category?: string | null;
}

export interface TaskResult {
  success: boolean;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  reason?: string | null;
}

export interface BatchContext {
  repoFullName: string;
  repoName: string;
  projectName?: string;
  branchName?: string;
  existingBranch?: string | null;
  topicId: number | null;
  projectMemoryText?: string;
}

export type BatchResult =
  | {
      status: 'failed';
      reason: string;
      taskBranch: string;
      lastStdout: string;
      lastStderr: string;
    }
  | {
      status: 'completed';
      taskBranch: string;
      commitSha: string | null;
      commitUrl: string;
      completedTasks: BuildableTask[];
      skippedCount: number;
      remainingTasks: number;
      builderUsed: string;
    }
  | {
      status: 'error';
      reason: string;
      lastStdout?: string;
      lastStderr?: string;
    };
