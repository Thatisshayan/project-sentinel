interface AuditPayload {
    repoFullName: string;
    repoName?: string;
    projectName?: string;
    commitSha?: string;
    branchName?: string;
}
declare function runAudit(payload: AuditPayload): Promise<any>;
declare const _default: {
    runAudit: typeof runAudit;
};
export = _default;
//# sourceMappingURL=claudeCodeAudit.d.ts.map