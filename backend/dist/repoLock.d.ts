declare function lockRepo(repoName: string, reason?: string): Promise<void>;
declare function unlockRepo(repoName: string): Promise<void>;
declare function isRepoLocked(repoName: string): Promise<any>;
declare function getAllLocked(): Promise<any[]>;
declare const _default: {
    lockRepo: typeof lockRepo;
    unlockRepo: typeof unlockRepo;
    isRepoLocked: typeof isRepoLocked;
    getAllLocked: typeof getAllLocked;
};
export = _default;
//# sourceMappingURL=repoLock.d.ts.map