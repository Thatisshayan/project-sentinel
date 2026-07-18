declare function getRepoStats(repoFullName: string, repoName: string): Promise<any>;
declare function refreshRepoMetrics(repoFullName: string, repoName: string): Promise<any>;
declare function refreshAllMetrics(): Promise<any[]>;
declare function getPortfolioSummary(): Promise<any>;
declare const _default: {
    refreshAllMetrics: typeof refreshAllMetrics;
    refreshRepoMetrics: typeof refreshRepoMetrics;
    getPortfolioSummary: typeof getPortfolioSummary;
    getRepoStats: typeof getRepoStats;
    REPO_LIST: {
        repoName: string;
        repoFullName: string;
    }[];
};
export = _default;
//# sourceMappingURL=portfolioAnalytics.d.ts.map