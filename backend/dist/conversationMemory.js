"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const safeFire_1 = require("./utils/safeFire");
const dbClient_1 = require("./dbClient");
const logger_1 = __importDefault(require("./logger"));
async function initConversationSchema() {
    await (0, dbClient_1.query)(`
    CREATE TABLE IF NOT EXISTS conversation_history (
      id         SERIAL PRIMARY KEY,
      topic_id   TEXT NOT NULL,
      from_name  TEXT NOT NULL,
      message    TEXT NOT NULL,
      response   TEXT,
      agent_id   TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
    await (0, dbClient_1.query)(`
    CREATE INDEX IF NOT EXISTS idx_conv_topic_time
      ON conversation_history (topic_id, created_at DESC);
  `);
    logger_1.default.info('Conversation memory schema ready');
}
async function saveMessage(topicId, fromName, message, response, agentId = null) {
    await (0, safeFire_1.safeFire)((0, dbClient_1.query)(`
    INSERT INTO conversation_history (topic_id, from_name, message, response, agent_id)
    VALUES ($1, $2, $3, $4, $5)
  `, [String(topicId || 'main'), fromName, message, response, agentId]), { label: 'conversationMemory' });
}
async function getHistory(topicId, limit = 15) {
    const r = await (0, dbClient_1.query)(`
    SELECT from_name, message, response, agent_id, created_at
    FROM conversation_history
    WHERE topic_id = $1
      AND created_at > NOW() - INTERVAL '7 days'
    ORDER BY created_at DESC
    LIMIT $2
  `, [String(topicId || 'main'), limit]).catch(() => ({ rows: [] }));
    return r.rows.reverse();
}
function formatHistoryForPrompt(rows) {
    if (!rows || rows.length === 0)
        return '';
    const lines = rows.map((r) => {
        const agent = r.agent_id ? ` [via ${r.agent_id}]` : '';
        const resp = r.response ? `\nSentinel${agent}: ${r.response.slice(0, 200)}` : '';
        return `${r.from_name}: ${r.message.slice(0, 200)}${resp}`;
    });
    return `\nCONVERSATION HISTORY (last ${rows.length} exchanges):\n${lines.join('\n')}\n`;
}
module.exports = { initConversationSchema, saveMessage, getHistory, formatHistoryForPrompt };
//# sourceMappingURL=conversationMemory.js.map