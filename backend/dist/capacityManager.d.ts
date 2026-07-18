declare function getCapacityStatus(): Promise<any>;
declare function estimateTaskCost(builderAgent: string, count?: number): number;
declare function selectBuilder(repoName: string, capacity: any, notionBuilder: string): string;
declare const _default: {
    getCapacityStatus: typeof getCapacityStatus;
    estimateTaskCost: typeof estimateTaskCost;
    selectBuilder: typeof selectBuilder;
};
export = _default;
//# sourceMappingURL=capacityManager.d.ts.map