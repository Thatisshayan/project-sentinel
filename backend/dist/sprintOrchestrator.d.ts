declare function approveSprint(topicId: number | null): Promise<void>;
declare function executeNextSprintTask(sprintId: number, topicId: number | null): Promise<void>;
declare function getSprintStatus(topicId: number | null): Promise<void>;
declare function pauseSprint(topicId: number | null): Promise<void>;
declare function resumeSprint(topicId: number | null): Promise<void>;
declare const _default: {
    approveSprint: typeof approveSprint;
    executeNextSprintTask: typeof executeNextSprintTask;
    getSprintStatus: typeof getSprintStatus;
    pauseSprint: typeof pauseSprint;
    resumeSprint: typeof resumeSprint;
};
export = _default;
//# sourceMappingURL=sprintOrchestrator.d.ts.map