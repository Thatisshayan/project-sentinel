declare function sendAsAgent(agentId: string, text: string, replyToMessageId?: number | null): Promise<any>;
declare function replyAsAgent(agentId: string, replyToMessageId: number, text: string): Promise<any>;
declare function agentToAgent(fromAgentId: string, toAgentId: string, text: string): Promise<any>;
declare function getConfiguredBots(): {
    configured: string[];
    missing: string[];
};
declare function configureBotProfile(agentId: string, description: string): Promise<void>;
declare const _default: {
    sendAsAgent: typeof sendAsAgent;
    replyAsAgent: typeof replyAsAgent;
    agentToAgent: typeof agentToAgent;
    getConfiguredBots: typeof getConfiguredBots;
    configureBotProfile: typeof configureBotProfile;
};
export = _default;
//# sourceMappingURL=agentBots.d.ts.map