declare function findNotionProject(repoName: string): Promise<any>;
declare function updateNotionProject(pageId: string, data: any): Promise<void>;
declare function appendChangelog(pageId: string, data: any): Promise<void>;
declare function updateBuilderAgent(pageId: string, agentId: string): Promise<void>;
declare function bustNotionCache(): void;
declare const _default: {
    findNotionProject: typeof findNotionProject;
    updateNotionProject: typeof updateNotionProject;
    appendChangelog: typeof appendChangelog;
    updateBuilderAgent: typeof updateBuilderAgent;
    bustNotionCache: typeof bustNotionCache;
};
export = _default;
//# sourceMappingURL=notionClient.d.ts.map