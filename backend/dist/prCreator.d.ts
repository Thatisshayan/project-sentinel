declare function createPullRequest({ repoFullName, fixBranch, baseBranch, context }: {
    repoFullName: string;
    fixBranch: string;
    baseBranch?: string;
    context: any;
}): Promise<{
    prUrl: string | null;
    prNumber: number | null;
}>;
declare const _default: {
    createPullRequest: typeof createPullRequest;
};
export = _default;
//# sourceMappingURL=prCreator.d.ts.map