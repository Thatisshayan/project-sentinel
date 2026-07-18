declare function triggerAudit(payload: any): Promise<void>;
declare function executeApprovedTasks(repoFullName: string, repoName: string, topicId: number | null): Promise<void>;
declare function processNextBatch(repoFullName: string, repoName: string, topicId: number | null): Promise<void>;
declare function handleBuildPassedAfterSentinelMerge(repoFullName: string, repoName: string, branchName: string, topicId: number | null): Promise<void>;
declare const _default: {
    triggerAudit: typeof triggerAudit;
    executeApprovedTasks: typeof executeApprovedTasks;
    processNextBatch: typeof processNextBatch;
    handleBuildPassedAfterSentinelMerge: typeof handleBuildPassedAfterSentinelMerge;
};
export = _default;
//# sourceMappingURL=auditOrchestrator.d.ts.map