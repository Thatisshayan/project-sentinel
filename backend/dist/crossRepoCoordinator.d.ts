declare function getDependents(repoName: string): string[];
declare function notifyDependents(pushedRepo: string, pushedCommitSha: string, authorName: string): Promise<void>;
declare function describeDependencies(): string;
declare const _default: {
    notifyDependents: typeof notifyDependents;
    getDependents: typeof getDependents;
    describeDependencies: typeof describeDependencies;
};
export = _default;
//# sourceMappingURL=crossRepoCoordinator.d.ts.map