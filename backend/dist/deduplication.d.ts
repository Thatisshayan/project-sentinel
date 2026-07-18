declare function isAlreadyProcessed(repoName: string, commitSha: string): Promise<boolean>;
declare function markAsProcessed(repoName: string, commitSha: string): Promise<void>;
declare const _default: {
    isAlreadyProcessed: typeof isAlreadyProcessed;
    markAsProcessed: typeof markAsProcessed;
};
export = _default;
//# sourceMappingURL=deduplication.d.ts.map