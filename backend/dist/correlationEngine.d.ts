declare function snapshotBeforeMerge(repoFullName: string, prNumber: string | number, prUrl: string): Promise<any>;
declare function checkPostMergeImpact(impactId: any, repoName: string): Promise<void>;
declare function getCorrelationSummary(repoName: string): Promise<any>;
declare const _default: {
    snapshotBeforeMerge: typeof snapshotBeforeMerge;
    checkPostMergeImpact: typeof checkPostMergeImpact;
    getCorrelationSummary: typeof getCorrelationSummary;
};
export = _default;
//# sourceMappingURL=correlationEngine.d.ts.map