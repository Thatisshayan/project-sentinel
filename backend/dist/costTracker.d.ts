declare function trackAuditCost(repoFullName: string, promptLength: string | number, outputLength: string | number): Promise<number>;
declare function trackBuildTaskCost(repoFullName: string, promptLength: string | number, outputLength: string | number): Promise<number>;
declare function trackChatCost(promptLength: string | number, outputLength: string | number): Promise<number>;
declare function getCostReport(): Promise<any>;
declare const _default: {
    trackAuditCost: typeof trackAuditCost;
    trackBuildTaskCost: typeof trackBuildTaskCost;
    trackChatCost: typeof trackChatCost;
    getCostReport: typeof getCostReport;
};
export = _default;
//# sourceMappingURL=costTracker.d.ts.map