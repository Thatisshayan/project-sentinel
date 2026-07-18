interface Task {
    task_number: number;
    title: string;
    priority: string;
    category: string;
    description: string;
    affected_files?: string[];
    acceptance_criteria?: string;
}
interface TaskContext {
    projectName?: string;
    repoName?: string;
}
interface ClaudeCodeResult {
    success: boolean;
    exitCode?: number | null;
    stdout?: string;
    stderr?: string;
    reason?: string | null;
}
declare function runClaudeCodeForTask(repoPath: string, task: Task, context: TaskContext): Promise<ClaudeCodeResult>;
declare const _default: {
    runClaudeCodeForTask: typeof runClaudeCodeForTask;
};
export = _default;
//# sourceMappingURL=claudeCodeRunner.d.ts.map