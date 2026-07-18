declare function initAgentSchema(): Promise<void>;
declare function registerAgent(agentId: string, agentLabel: string): Promise<void>;
declare function setAgentWorking(agentId: string, data: {
    repoFullName: string;
    taskType: string;
    taskId: number;
    taskTitle: string;
}): Promise<void>;
declare function setAgentIdle(agentId: string, success?: boolean): Promise<void>;
declare function markAgentError(agentId: string, reason: string): Promise<void>;
declare function getActiveAgents(): Promise<any[]>;
declare function getIdleAgents(): Promise<any[]>;
declare function getAllAgents(): Promise<any[]>;
declare function acquireFileLocks(repoFullName: string, filePaths: string[], agentId: string, taskId: number): Promise<{
    acquired: string[];
    conflicts: {
        filePath: string;
        lockedBy: string;
    }[];
}>;
declare function releaseFileLocks(repoFullName: string, agentId: string): Promise<string[]>;
declare function releaseExpiredLocks(): Promise<any[]>;
declare function logAgentMessage(agentId: string, agentLabel: string, message: string, type?: string, repoName?: string): Promise<void>;
declare function getRecentMessages(limit?: number): Promise<any[]>;
declare function getConfig(key: string): Promise<string | null>;
declare function setConfig(key: string, value: any): Promise<void>;
declare const _default: {
    initAgentSchema: typeof initAgentSchema;
    registerAgent: typeof registerAgent;
    setAgentWorking: typeof setAgentWorking;
    setAgentIdle: typeof setAgentIdle;
    markAgentError: typeof markAgentError;
    getActiveAgents: typeof getActiveAgents;
    getIdleAgents: typeof getIdleAgents;
    getAllAgents: typeof getAllAgents;
    acquireFileLocks: typeof acquireFileLocks;
    releaseFileLocks: typeof releaseFileLocks;
    releaseExpiredLocks: typeof releaseExpiredLocks;
    logAgentMessage: typeof logAgentMessage;
    getRecentMessages: typeof getRecentMessages;
    getConfig: typeof getConfig;
    setConfig: typeof setConfig;
};
export = _default;
//# sourceMappingURL=agentDb.d.ts.map