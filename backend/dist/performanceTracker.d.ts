declare function trackModelCall<T>(modelId: string, taskType: string, complexity: string, fn: () => Promise<T>): Promise<T>;
declare function getRecommendedModel(taskType: string, fallback?: string): Promise<string>;
declare function getPerformanceReport(): Promise<string>;
declare const _default: {
    trackModelCall: typeof trackModelCall;
    getRecommendedModel: typeof getRecommendedModel;
    getPerformanceReport: typeof getPerformanceReport;
};
export = _default;
//# sourceMappingURL=performanceTracker.d.ts.map