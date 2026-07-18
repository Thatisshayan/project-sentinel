declare function initConversationSchema(): Promise<void>;
declare function saveMessage(topicId: string | number, fromName: string, message: string, response: string | null, agentId?: string | null): Promise<void>;
declare function getHistory(topicId: string | number, limit?: number): Promise<any[]>;
declare function formatHistoryForPrompt(rows: any[]): string;
declare const _default: {
    initConversationSchema: typeof initConversationSchema;
    saveMessage: typeof saveMessage;
    getHistory: typeof getHistory;
    formatHistoryForPrompt: typeof formatHistoryForPrompt;
};
export = _default;
//# sourceMappingURL=conversationMemory.d.ts.map