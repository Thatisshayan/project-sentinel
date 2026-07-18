declare function listAllOwnedRepos(): Promise<any[]>;
declare function discoverAndOnboardRepos(): Promise<{
    discovered: number;
    repos?: string[];
    seeded?: number;
    error?: string;
}>;
declare function getFullRepoList(): Promise<Array<{
    repoName: string;
    repoFullName: string;
}>>;
declare const _default: {
    discoverAndOnboardRepos: typeof discoverAndOnboardRepos;
    getFullRepoList: typeof getFullRepoList;
    listAllOwnedRepos: typeof listAllOwnedRepos;
};
export = _default;
//# sourceMappingURL=repoDiscovery.d.ts.map