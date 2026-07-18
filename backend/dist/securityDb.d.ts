declare function initSecuritySchema(): Promise<void>;
declare function createSecurityScan(data: {
    repoFullName: string;
    commitSha: string;
    branchName?: string;
}): Promise<any>;
declare function updateSecurityScan(id: number, updates: Record<string, any>): Promise<any | null>;
declare function insertSecurityIssue(data: {
    scanId: number;
    repoFullName: string;
    issueType: string;
    severity: string;
    title: string;
    description?: string;
    filePath?: string;
    lineNumber?: number;
    cveId?: string;
    cvssScore?: number;
    fixAvailable?: boolean;
    fixDescription?: string;
    autoFixable?: boolean;
}): Promise<number | undefined>;
declare function getOpenIssues(repoFullName: string, severity?: string | null): Promise<any[]>;
declare function upsertSecurityScore(repoName: string, data: {
    score: number;
    vulnerabilities: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
}): Promise<void>;
declare function upsertOwaspItem(repoName: string, owaspItem: string, status: string, notes?: string): Promise<void>;
declare function getLatestSecurityScore(repoName: string): Promise<any | null>;
declare function getPortfolioSecuritySummary(): Promise<any[]>;
declare const _default: {
    initSecuritySchema: typeof initSecuritySchema;
    createSecurityScan: typeof createSecurityScan;
    updateSecurityScan: typeof updateSecurityScan;
    insertSecurityIssue: typeof insertSecurityIssue;
    getOpenIssues: typeof getOpenIssues;
    upsertSecurityScore: typeof upsertSecurityScore;
    upsertOwaspItem: typeof upsertOwaspItem;
    getLatestSecurityScore: typeof getLatestSecurityScore;
    getPortfolioSecuritySummary: typeof getPortfolioSecuritySummary;
};
export = _default;
//# sourceMappingURL=securityDb.d.ts.map