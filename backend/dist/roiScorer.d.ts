declare function scoreTask(task: any, repoName: string, repoPriority: string): Promise<number>;
declare function scoreAllQueuedTasks(): Promise<void>;
declare const _default: {
    scoreTask: typeof scoreTask;
    scoreAllQueuedTasks: typeof scoreAllQueuedTasks;
};
export = _default;
//# sourceMappingURL=roiScorer.d.ts.map