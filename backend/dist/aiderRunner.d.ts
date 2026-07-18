interface AiderContext {
    failureReason?: string;
    failureLogs?: string;
    changedFiles?: string[];
    buildProvider?: string;
    attemptNumber?: number;
    repoFullName?: string;
    branchName?: string;
}
interface CloneResult {
    status: string;
    reason?: string;
    fixBranch?: string;
    aiderOutput?: string;
    commitSha?: string;
    commitMessage?: string;
    filesChanged?: string[];
}
declare function cloneAndFix(context: AiderContext): Promise<CloneResult>;
declare const _default: {
    cloneAndFix: typeof cloneAndFix;
};
export = _default;
//# sourceMappingURL=aiderRunner.d.ts.map