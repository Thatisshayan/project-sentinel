declare function initSprintSchema(): Promise<void>;
declare function getCurrentSprint(): Promise<any | null>;
declare function getSprintById(id: number): Promise<any | null>;
declare function createSprint(data: {
    weekStart: string;
    weekEnd: string;
    totalTasks: number;
    estimatedCost: number;
    healthStart: number;
    proposalSummary: string;
}): Promise<any>;
declare function updateSprint(id: number, updates: Record<string, any>): Promise<any | null>;
declare function createSprintTask(data: {
    sprintId: number;
    auditTaskId?: number;
    repoFullName: string;
    repoName: string;
    taskTitle: string;
    taskDescription?: string;
    priority?: string;
    complexity?: string;
    builderAgent?: string;
    estimatedCost?: number;
    executionOrder: number;
}): Promise<any>;
declare function getNextSprintTask(sprintId: number): Promise<any | null>;
declare function updateSprintTask(id: number, updates: Record<string, any>): Promise<any | null>;
declare function getSprintTasks(sprintId: number): Promise<any[]>;
declare function recordVelocity(data: {
    weekStart: string;
    tasksCompleted: number;
    prsMerged: number;
    buildsFixed: number;
    avgHealth: number;
    healthDelta: number;
    apiCost: number;
    activeRepos: number;
}): Promise<void>;
declare function getVelocityTrend(weeks?: number): Promise<any[]>;
declare const _default: {
    initSprintSchema: typeof initSprintSchema;
    getCurrentSprint: typeof getCurrentSprint;
    getSprintById: typeof getSprintById;
    createSprint: typeof createSprint;
    updateSprint: typeof updateSprint;
    createSprintTask: typeof createSprintTask;
    getNextSprintTask: typeof getNextSprintTask;
    updateSprintTask: typeof updateSprintTask;
    getSprintTasks: typeof getSprintTasks;
    recordVelocity: typeof recordVelocity;
    getVelocityTrend: typeof getVelocityTrend;
};
export = _default;
//# sourceMappingURL=sprintDb.d.ts.map