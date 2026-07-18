declare function initBusinessSchema(): Promise<void>;
declare function upsertMetric(data: {
    repoName: string;
    service: string;
    metricName: string;
    metricValue: number;
    metricUnit?: string;
    recordedDate?: string;
}): Promise<void>;
declare function getMetricTrend(repoName: string, metricName: string, days?: number): Promise<any[]>;
declare function getLatestMetrics(repoName: string): Promise<any[]>;
declare function recordPRImpact(data: {
    repoFullName: string;
    prNumber: number;
    prUrl: string;
    mergedAt: string;
    preSnapshot: any;
}): Promise<number | undefined>;
declare function updatePRImpact(id: number, postSnapshot: any): Promise<{
    delta: Record<string, any>;
    score: string | number;
}>;
declare function upsertTaskROI(data: {
    auditTaskId: number;
    repoName: string;
    baseScore: number;
    priorityBonus: number;
    healthBonus: number;
    revenueBonus: number;
    finalScore: number;
    scoringReason: string;
}): Promise<void>;
declare const _default: {
    initBusinessSchema: typeof initBusinessSchema;
    upsertMetric: typeof upsertMetric;
    getMetricTrend: typeof getMetricTrend;
    getLatestMetrics: typeof getLatestMetrics;
    recordPRImpact: typeof recordPRImpact;
    updatePRImpact: typeof updatePRImpact;
    upsertTaskROI: typeof upsertTaskROI;
};
export = _default;
//# sourceMappingURL=businessDb.d.ts.map