declare function pullFirebaseMetrics(): Promise<void>;
declare function recordCustomMetric(repoName: string, service: string, metricName: string, value: number, unit?: string): Promise<void>;
declare function pullAllMetrics(): Promise<void>;
declare function getRepoBusinessSummary(repoName: string): Promise<string | null>;
declare const _default: {
    pullAllMetrics: typeof pullAllMetrics;
    pullFirebaseMetrics: typeof pullFirebaseMetrics;
    recordCustomMetric: typeof recordCustomMetric;
    getRepoBusinessSummary: typeof getRepoBusinessSummary;
};
export = _default;
//# sourceMappingURL=businessMetrics.d.ts.map