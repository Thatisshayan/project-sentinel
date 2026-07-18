declare function assessRisk(changedFiles: string[]): string;
declare function isMarketingOnly(changedFiles: string[]): boolean;
declare function assessLogRisk(failureLogs: string | null, buildProvider: string): {
    isHighRisk: boolean;
    reason: string | null;
};
declare function sanitizeLogs(logs: string | null): string;
declare const _default: {
    assessRisk: typeof assessRisk;
    isMarketingOnly: typeof isMarketingOnly;
    assessLogRisk: typeof assessLogRisk;
    sanitizeLogs: typeof sanitizeLogs;
};
export = _default;
//# sourceMappingURL=riskAssessor.d.ts.map