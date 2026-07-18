declare function initAgentPool(): Promise<void>;
declare function selectAgent(taskComplexity: string, preferredBuilder?: string): Promise<string>;
declare function assignAgent(agentId: string, taskData: any): Promise<void>;
declare function freeAgent(agentId: string, success?: boolean): Promise<void>;
declare const _default: {
    initAgentPool: typeof initAgentPool;
    selectAgent: typeof selectAgent;
    assignAgent: typeof assignAgent;
    freeAgent: typeof freeAgent;
};
export = _default;
//# sourceMappingURL=agentRegistry.d.ts.map