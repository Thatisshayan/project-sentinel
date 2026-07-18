"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startAgentCleanupWorker = startAgentCleanupWorker;
const safeFire_1 = require("../utils/safeFire");
const agentDb_1 = require("../agentDb");
const agentRoom_1 = require("../agentRoom");
const logger_1 = __importDefault(require("../logger"));
function startAgentCleanupWorker() {
    // Release expired file locks every hour
    setInterval(() => {
        (0, safeFire_1.fireAndForget)((0, agentDb_1.releaseExpiredLocks)(), { label: 'workers' });
    }, 60 * 60 * 1000);
    // Improvement 1 — update pinned status board every 30 minutes
    setInterval(() => {
        (0, safeFire_1.fireAndForget)((0, agentRoom_1.updatePinnedStatusBoard)(), { label: 'workers' });
    }, 30 * 60 * 1000);
    // Send initial status board on startup (non-blocking)
    (0, safeFire_1.fireAndForget)((0, agentRoom_1.updatePinnedStatusBoard)(), { label: 'workers' });
    logger_1.default.info('Agent cleanup worker started (locks every 1h, status board every 30m)');
}
//# sourceMappingURL=agentCleanupWorker.js.map