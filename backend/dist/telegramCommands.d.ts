declare function handleCommand(text: string, chatId: number, topicId: number | null, fromName: string, message?: any): Promise<boolean>;
declare function handleCallbackQuery(callbackQuery: any): Promise<boolean>;
declare const _default: {
    handleCommand: typeof handleCommand;
    handleCallbackQuery: typeof handleCallbackQuery;
};
export = _default;
//# sourceMappingURL=telegramCommands.d.ts.map