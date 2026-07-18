interface InlineButton {
    text: string;
    callback_data: string;
}
declare function sendMenu(chatId: number, threadId: number | null, text: string, buttons: InlineButton[][]): Promise<void>;
declare function showMainMenu(chatId: number, threadId: number | null): Promise<void>;
declare function showRepoMenu(chatId: number, threadId: number | null, repoName: string): Promise<void>;
declare function showApprovalsMenu(chatId: number, threadId: number | null, pending: any): Promise<void>;
declare function showDidYouMean(chatId: number, threadId: number | null, suggestions: any[]): Promise<void>;
declare const _default: {
    showMainMenu: typeof showMainMenu;
    showRepoMenu: typeof showRepoMenu;
    showApprovalsMenu: typeof showApprovalsMenu;
    showDidYouMean: typeof showDidYouMean;
    sendMenu: typeof sendMenu;
};
export = _default;
//# sourceMappingURL=telegramMenus.d.ts.map