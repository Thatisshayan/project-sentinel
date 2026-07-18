declare function writeTasksToNotion(auditResult: any, auditCycleId: any, payload: any): Promise<any>;
declare function updateNotionTaskStatus(notionPageId: string | null, status: string, extra?: any): Promise<void>;
declare const _default: {
    writeTasksToNotion: typeof writeTasksToNotion;
    updateNotionTaskStatus: typeof updateNotionTaskStatus;
};
export = _default;
//# sourceMappingURL=auditTaskWriter.d.ts.map