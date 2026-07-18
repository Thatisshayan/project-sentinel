declare function scheduleAutoApprove(sprintId: string | number, topicId: string | null): Promise<void>;
declare function cancelAutoApprove(): Promise<boolean>;
declare function isPendingAutoApprove(): Promise<boolean>;
declare const _default: {
    scheduleAutoApprove: typeof scheduleAutoApprove;
    cancelAutoApprove: typeof cancelAutoApprove;
    isPendingAutoApprove: typeof isPendingAutoApprove;
};
export = _default;
//# sourceMappingURL=autoApprover.d.ts.map