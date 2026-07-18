interface GitHubRunResult {
    provider: string;
    status: string;
    workflowName?: string;
    runUrl?: string;
    failedJobName?: string | null;
    logsUrl?: string | null;
    conclusion?: string | null;
    error?: string;
}
declare function checkGitHubActions(repoFullName: string, commitSha: string): Promise<GitHubRunResult>;
interface VercelResult {
    provider: string;
    status: string;
    deploymentUrl?: string | null;
    inspectUrl?: string | null;
    failureReason?: string | null;
    error?: string;
}
declare function checkVercel(repoFullName: string, commitSha: string): Promise<VercelResult>;
interface RailwayResult {
    provider: string;
    status: string;
    deploymentUrl?: string | null;
    buildUrl?: string;
    failureReason?: string | null;
    error?: string;
}
declare function checkRailway(repoFullName: string, commitSha: string): Promise<RailwayResult>;
interface AggregateResult {
    overall: string;
    providers: Array<GitHubRunResult | VercelResult | RailwayResult>;
    primaryFailure?: GitHubRunResult | VercelResult | RailwayResult | null;
    buildUrl?: string | null;
    logsUrl?: string | null;
    failureReason?: string | null;
    buildProvider?: string;
}
declare function checkAllProviders(repoFullName: string, commitSha: string): Promise<AggregateResult>;
declare const _default: {
    checkAllProviders: typeof checkAllProviders;
    checkGitHubActions: typeof checkGitHubActions;
    checkVercel: typeof checkVercel;
    checkRailway: typeof checkRailway;
};
export = _default;
//# sourceMappingURL=buildPoller.d.ts.map