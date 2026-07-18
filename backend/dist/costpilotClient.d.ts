declare function isConfigured(): boolean;
declare function logCost(data: any): Promise<void>;
declare function getSpendSummary(period?: string): Promise<any>;
declare function getRepoBreakdown(days?: number): Promise<any[]>;
declare const _default: {
    logCost: typeof logCost;
    getSpendSummary: typeof getSpendSummary;
    getRepoBreakdown: typeof getRepoBreakdown;
    isConfigured: typeof isConfigured;
};
export = _default;
//# sourceMappingURL=costpilotClient.d.ts.map