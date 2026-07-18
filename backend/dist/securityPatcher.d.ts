interface SecurityIssue {
    auto_fixable: boolean;
    issue_type: string;
    severity: string;
    title: string;
    description: string;
    [key: string]: any;
}
declare function applySecurityPatches(repoFullName: string, repoName: string, issues: SecurityIssue[], topicId?: any): Promise<void>;
declare const _default: {
    applySecurityPatches: typeof applySecurityPatches;
};
export = _default;
//# sourceMappingURL=securityPatcher.d.ts.map