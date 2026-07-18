declare function getWatchedRepos(): string[];
declare function onboardRepo(repoName: string): Promise<void>;
declare function checkAndOnboardNewRepos(): Promise<void>;
declare function registerWebhook(repoName: string): Promise<void>;
declare const _default: {
    checkAndOnboardNewRepos: typeof checkAndOnboardNewRepos;
    getWatchedRepos: typeof getWatchedRepos;
    onboardRepo: typeof onboardRepo;
    registerWebhook: typeof registerWebhook;
};
export = _default;
//# sourceMappingURL=repoOnboarder.d.ts.map