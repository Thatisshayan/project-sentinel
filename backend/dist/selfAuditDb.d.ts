declare function initSelfAuditSchema(): Promise<void>;
declare function recordModelOutcome(data: {
    modelId: string;
    taskType: string;
    complexity?: string;
    success: boolean;
    durationMs?: number;
    repoFullName?: string;
}): Promise<void>;
declare function getModelScores(taskType: string): Promise<any[]>;
declare function getBestModelForTask(taskType: string): Promise<string | null>;
declare function recordComponentFailure(componentName: string, errorMessage?: string): Promise<void>;
declare function recordComponentSuccess(componentName: string): Promise<void>;
declare function getDegradedComponents(): Promise<any[]>;
declare function createSelfAuditCycle(): Promise<any>;
declare function updateSelfAuditCycle(id: number, updates: Record<string, any>): Promise<any | null>;
declare const _default: {
    initSelfAuditSchema: typeof initSelfAuditSchema;
    recordModelOutcome: typeof recordModelOutcome;
    getModelScores: typeof getModelScores;
    getBestModelForTask: typeof getBestModelForTask;
    recordComponentFailure: typeof recordComponentFailure;
    recordComponentSuccess: typeof recordComponentSuccess;
    getDegradedComponents: typeof getDegradedComponents;
    createSelfAuditCycle: typeof createSelfAuditCycle;
    updateSelfAuditCycle: typeof updateSelfAuditCycle;
};
export = _default;
//# sourceMappingURL=selfAuditDb.d.ts.map