import { Queue } from 'bullmq';
import IORedis from 'ioredis';
declare function getRedisConnection(): IORedis | null;
declare function getBuildPollQueue(): Queue | null;
declare function getDebugQueue(): Queue | null;
declare function enqueueBuildCheck(data: any): Promise<any>;
declare function enqueueDebug(data: any): Promise<any>;
declare const _default: {
    getRedisConnection: typeof getRedisConnection;
    getBuildPollQueue: typeof getBuildPollQueue;
    getDebugQueue: typeof getDebugQueue;
    enqueueBuildQueue: typeof enqueueBuildCheck;
    enqueueBuildCheck: typeof enqueueBuildCheck;
    enqueueDebug: typeof enqueueDebug;
};
export = _default;
//# sourceMappingURL=queueClient.d.ts.map