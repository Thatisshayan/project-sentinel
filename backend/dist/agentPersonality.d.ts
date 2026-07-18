declare function getPersonalityPrompt(agentId: string): string;
type StandupStats = {
    audits?: number;
    tasksGenerated?: number;
    failed?: number;
    prs?: number;
    tasks?: number;
    done?: number;
    debugs?: number;
    issues?: number;
    complex?: number;
};
declare function getStandupLine(agentId: string, stats: StandupStats): string;
declare const _default: {
    getPersonalityPrompt: typeof getPersonalityPrompt;
    getStandupLine: typeof getStandupLine;
    PERSONALITIES: Record<string, string>;
};
export = _default;
//# sourceMappingURL=agentPersonality.d.ts.map