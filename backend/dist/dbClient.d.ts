import { QueryResult, QueryResultRow } from 'pg';
declare function query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>>;
declare function initSchema(): Promise<void>;
declare function getDebugAttempt(repoFullName: string, commitSha: string): Promise<any | null>;
interface DebugAttemptData {
    repoFullName: string;
    commitSha: string;
    buildProvider?: string;
    buildUrl?: string;
    failureReason?: string;
}
declare function createDebugAttempt(data: DebugAttemptData): Promise<any | null>;
declare function incrementAttempt(repoFullName: string, commitSha: string, debuggerUsed: string): Promise<any | null>;
declare function updateDebugAttempt(repoFullName: string, commitSha: string, updates: Record<string, any>): Promise<any | null>;
declare function stopDebugAttempts(repoFullName: string): Promise<void>;
declare const _default: {
    query: typeof query;
    initSchema: typeof initSchema;
    getDebugAttempt: typeof getDebugAttempt;
    createDebugAttempt: typeof createDebugAttempt;
    incrementAttempt: typeof incrementAttempt;
    updateDebugAttempt: typeof updateDebugAttempt;
    stopDebugAttempts: typeof stopDebugAttempts;
};
export = _default;
//# sourceMappingURL=dbClient.d.ts.map