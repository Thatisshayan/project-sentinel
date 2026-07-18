declare function getGithubOrg(): string;
declare function repoFullName(repoName: string): string;
declare function canonicalizeRepoName(input: string): {
    repoName: string;
    repoFullName: string;
} | null;
declare const _default: {
    getGithubOrg: typeof getGithubOrg;
    repoFullName: typeof repoFullName;
    canonicalizeRepoName: typeof canonicalizeRepoName;
};
export = _default;
//# sourceMappingURL=repoResolver.d.ts.map