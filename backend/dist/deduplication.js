"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const logger_1 = __importDefault(require("./logger"));
const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 2000;
const store = new Map();
function makeKey(repoName, commitSha) {
    return `${repoName.toLowerCase()}:${commitSha}`;
}
function pruneExpired() {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
        if (now - entry.ts > TTL_MS) {
            store.delete(key);
        }
    }
}
async function isAlreadyProcessed(repoName, commitSha) {
    const key = makeKey(repoName, commitSha);
    const entry = store.get(key);
    if (!entry)
        return false;
    if (Date.now() - entry.ts > TTL_MS) {
        store.delete(key);
        return false;
    }
    logger_1.default.info({ repoName, commitSha: commitSha.slice(0, 7) }, 'Duplicate event detected');
    return true;
}
async function markAsProcessed(repoName, commitSha) {
    const key = makeKey(repoName, commitSha);
    store.set(key, { ts: Date.now() });
    if (store.size > MAX_ENTRIES) {
        pruneExpired();
        if (store.size > MAX_ENTRIES) {
            const toDelete = [...store.keys()].slice(0, Math.floor(MAX_ENTRIES / 4));
            toDelete.forEach((k) => store.delete(k));
        }
    }
}
module.exports = { isAlreadyProcessed, markAsProcessed };
//# sourceMappingURL=deduplication.js.map