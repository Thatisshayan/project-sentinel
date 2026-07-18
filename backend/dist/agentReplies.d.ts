declare function detectAgentReply(message: any): string | null;
declare function handleAgentReply(message: any, agentId: string, topicId: number): Promise<void>;
declare const _default: {
    detectAgentReply: typeof detectAgentReply;
    handleAgentReply: typeof handleAgentReply;
};
export = _default;
//# sourceMappingURL=agentReplies.d.ts.map