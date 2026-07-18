"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startSprintWorker = startSprintWorker;
const bullmq_1 = require("bullmq");
const queueClient_1 = require("../queueClient");
const selfAuditor_1 = require("../selfAuditor");
const selfHealer_1 = require("../selfHealer");
const sprintPlanner_1 = require("../sprintPlanner");
const velocityTracker_1 = require("../velocityTracker");
const sprintOrchestrator_1 = require("../sprintOrchestrator");
const logger_1 = __importDefault(require("../logger"));
const SENTINEL_TZ = process.env['SENTINEL_TIMEZONE'] || 'America/Toronto';
function startSprintWorker() {
    const conn = (0, queueClient_1.getRedisConnection)();
    if (!conn) {
        logger_1.default.warn('REDIS_URL not configured — sprint worker not started');
        return null;
    }
    const queue = new bullmq_1.Queue('sprint', { connection: conn });
    queue.add('propose', {}, {
        repeat: { pattern: '0 20 * * 0', tz: SENTINEL_TZ },
        jobId: 'sprint-proposal-cron',
    }).catch((err) => logger_1.default.warn({ err: err.message }, 'Could not schedule sprint proposal cron'));
    queue.add('midweek', {}, {
        repeat: { pattern: '0 9 * * 3', tz: SENTINEL_TZ },
        jobId: 'sprint-midweek-cron',
    }).catch((err) => logger_1.default.warn({ err: err.message }, 'Could not schedule sprint midweek cron'));
    queue.add('self-audit', {}, {
        repeat: { pattern: '0 21 * * 0', tz: SENTINEL_TZ },
        jobId: 'self-audit-cron',
    }).catch((err) => logger_1.default.warn({ err: err.message }, 'Could not schedule self-audit cron'));
    const worker = new bullmq_1.Worker('sprint', async (job) => {
        if (job.name === 'propose') {
            await (0, velocityTracker_1.recordWeeklyVelocity)();
            await (0, sprintPlanner_1.generateSprintProposal)();
        }
        if (job.name === 'midweek') {
            await (0, sprintOrchestrator_1.getSprintStatus)(null);
        }
        if (job.name === 'self-audit') {
            await (0, selfAuditor_1.runSelfAudit)();
            await (0, selfHealer_1.checkAndHeal)();
        }
    }, { connection: conn });
    worker.on('failed', (job, err) => {
        logger_1.default.error({ err: err.stack ?? err.message, job: job?.name }, 'Sprint worker job failed');
    });
    logger_1.default.info('Sprint worker started — proposes Sunday 8pm, mid-week update Wednesday 9am');
    return worker;
}
//# sourceMappingURL=sprintWorker.js.map