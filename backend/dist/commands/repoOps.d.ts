declare function handleStop(projectArg: string, topicId: number | null): Promise<boolean>;
declare function handleStatus(projectArg: string, topicId: number | null): Promise<boolean>;
declare function handleBuilds(projectArg: string, topicId: number | null): Promise<boolean>;
declare function handleRetry(projectArg: string, topicId: number | null): Promise<boolean>;
declare function handleHelp(topicId: number | null, chatId: string | null): Promise<boolean>;
declare function handleExecute(repoArg: string, topicId: number | null): Promise<boolean>;
declare function handleSkipAudit(repoArg: string, topicId: number | null): Promise<boolean>;
declare function handleManualAudit(repoArg: string, topicId: number | null): Promise<boolean>;
declare function handleListTasks(repoArg: string, topicId: number | null, chatId: string | null): Promise<boolean>;
declare function handleSkipBatch(repoArg: string, batchNumArg: string, topicId: number | null): Promise<boolean>;
declare function handleRepoOpsCmd(subcommand: string, parts: string[], chatId: string | null, topicId: number | null): Promise<boolean>;
declare const _default: {
    handleRepoOpsCmd: typeof handleRepoOpsCmd;
    handleStop: typeof handleStop;
    handleStatus: typeof handleStatus;
    handleBuilds: typeof handleBuilds;
    handleRetry: typeof handleRetry;
    handleHelp: typeof handleHelp;
    handleExecute: typeof handleExecute;
    handleSkipAudit: typeof handleSkipAudit;
    handleManualAudit: typeof handleManualAudit;
    handleListTasks: typeof handleListTasks;
    handleSkipBatch: typeof handleSkipBatch;
};
export = _default;
//# sourceMappingURL=repoOps.d.ts.map