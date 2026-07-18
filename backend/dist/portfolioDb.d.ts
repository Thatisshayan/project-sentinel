declare function initPortfolioSchema(): Promise<void>;
declare function upsertRepoMetrics(data: {
    repoFullName: string;
    repoName: string;
    healthScore?: number;
    buildStatus?: string;
    priority?: string;
    buildsPassedToday?: number;
    buildsFailedToday?: number;
    tasksDoneToday?: number;
    tasksQueued?: number;
    debuggerRunsToday?: number;
    lastBuildAt?: string;
    lastCommitAt?: string | Date;
}): Promise<void>;
declare function getLatestMetrics(repoFullName: string): Promise<any | null>;
declare function getAllLatestMetrics(): Promise<any[]>;
declare function logApiCost(data: {
    repoFullName?: string;
    operation: string;
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    estimatedCost?: number;
}): Promise<void>;
declare function getDailyCost(): Promise<number>;
declare function getMonthlyCost(): Promise<number>;
declare function getWeeklyCost(): Promise<number>;
declare function getCostByRepo(days?: number): Promise<any[]>;
declare function upsertPattern(data: {
    patternType: string;
    patternKey: string;
    description?: string;
    affectedRepos?: string[];
    severity?: string;
}): Promise<number>;
declare function getOpenPatterns(): Promise<any[]>;
declare function getDiscoveredRepoNames(): Promise<string[]>;
declare function getOnboardedDiscoveredRepos(): Promise<{
    repoName: string;
    repoFullName: string;
}[]>;
declare function insertDiscoveredRepo({ repoName, repoFullName, githubId, isPrivate }: {
    repoName: string;
    repoFullName: string;
    githubId?: number;
    isPrivate?: boolean;
}): Promise<void>;
declare function markDiscoveredRepoOnboarded(repoName: string, error?: string | null): Promise<void>;
declare const _default: {
    initPortfolioSchema: typeof initPortfolioSchema;
    upsertRepoMetrics: typeof upsertRepoMetrics;
    getLatestMetrics: typeof getLatestMetrics;
    getAllLatestMetrics: typeof getAllLatestMetrics;
    logApiCost: typeof logApiCost;
    getDailyCost: typeof getDailyCost;
    getWeeklyCost: typeof getWeeklyCost;
    getMonthlyCost: typeof getMonthlyCost;
    getCostByRepo: typeof getCostByRepo;
    upsertPattern: typeof upsertPattern;
    getOpenPatterns: typeof getOpenPatterns;
    getDiscoveredRepoNames: typeof getDiscoveredRepoNames;
    getOnboardedDiscoveredRepos: typeof getOnboardedDiscoveredRepos;
    insertDiscoveredRepo: typeof insertDiscoveredRepo;
    markDiscoveredRepoOnboarded: typeof markDiscoveredRepoOnboarded;
};
export = _default;
//# sourceMappingURL=portfolioDb.d.ts.map