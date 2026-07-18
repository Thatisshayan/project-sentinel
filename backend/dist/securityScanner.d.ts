interface ScanData {
    repoFullName: string;
    repoName: string;
    commitSha: string;
    branchName: string;
    topicId?: any;
}
interface SecurityIssue {
    severity: string;
    issueType: string;
    title: string;
    [key: string]: any;
}
interface ScanCounts {
    critical: number;
    high: number;
    medium: number;
    low: number;
}
declare function runSecurityScan(data: ScanData): Promise<{
    securityScore: number;
    issues: SecurityIssue[];
    counts: ScanCounts;
} | null>;
declare const _default: {
    runSecurityScan: typeof runSecurityScan;
};
export = _default;
//# sourceMappingURL=securityScanner.d.ts.map