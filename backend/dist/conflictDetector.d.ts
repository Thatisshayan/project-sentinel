declare function checkAndLockFiles(repoFullName: string, filePaths: string[], agentId: string, agentLabel: string, taskId: string | number): Promise<{
    canProceed: boolean;
    conflicts: any[];
    acquired: any[];
}>;
declare function releaseAllLocks(repoFullName: string, agentId: string): Promise<any[]>;
declare function getDependentRepos(repoFullName: string): string[];
declare function checkDependencyConflicts(repoFullName: string): Promise<{
    hasConflict: boolean;
    reason?: string;
}>;
declare function getPendingConflict(conflictId: string): any;
declare function resolvePendingConflict(conflictId: string): void;
declare const _default: {
    checkAndLockFiles: typeof checkAndLockFiles;
    releaseAllLocks: typeof releaseAllLocks;
    checkDependencyConflicts: typeof checkDependencyConflicts;
    getDependentRepos: typeof getDependentRepos;
    getPendingConflict: typeof getPendingConflict;
    resolvePendingConflict: typeof resolvePendingConflict;
};
export = _default;
//# sourceMappingURL=conflictDetector.d.ts.map