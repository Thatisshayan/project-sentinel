declare function getTopicId(repoName: string | null): number | null;
declare function sendTelegramMessage(text: string, repoName: string | null, explicitTopicId?: number | null, forceSend?: boolean): Promise<any>;
declare function registerBotCommands(): Promise<void>;
declare const _default: {
    sendTelegramMessage: typeof sendTelegramMessage;
    getTopicId: typeof getTopicId;
    registerBotCommands: typeof registerBotCommands;
};
export = _default;
//# sourceMappingURL=telegramClient.d.ts.map