import { safeFire, fireAndForget } from './utils/safeFire';
import { query } from './dbClient';
import logger from './logger';

async function initConversationSchema(): Promise<void> {
  await query(`
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
  await query(`
    CREATE INDEX IF NOT EXISTS idx_conv_topic_time
      ON conversation_history (topic_id, created_at DESC);
  `);
  logger.info('Conversation memory schema ready');
}

async function saveMessage(topicId: string | number, fromName: string, message: string, response: string | null, agentId: string | null = null): Promise<void> {
  await safeFire(query(`
    INSERT INTO conversation_history (topic_id, from_name, message, response, agent_id)
    VALUES ($1, $2, $3, $4, $5)
  `, [String(topicId || 'main'), fromName, message, response, agentId]), { label: 'conversationMemory' })
}

async function getHistory(topicId: string | number, limit = 15): Promise<any[]> {
  const r = await query(`
    SELECT from_name, message, response, agent_id, created_at
    FROM conversation_history
    WHERE topic_id = $1
      AND created_at > NOW() - INTERVAL '7 days'
    ORDER BY created_at DESC
    LIMIT $2
  `, [String(topicId || 'main'), limit]).catch(() => ({ rows: [] }));

  return r.rows.reverse();
}

function formatHistoryForPrompt(rows: any[]): string {
  if (!rows || rows.length === 0) return '';
  const lines = rows.map((r: any) => {
    const agent = r.agent_id ? ` [via ${r.agent_id}]` : '';
    const resp  = r.response ? `\nSentinel${agent}: ${r.response.slice(0, 200)}` : '';
    return `${r.from_name}: ${r.message.slice(0, 200)}${resp}`;
  });
  return `\nCONVERSATION HISTORY (last ${rows.length} exchanges):\n${lines.join('\n')}\n`;
}

export = { initConversationSchema, saveMessage, getHistory, formatHistoryForPrompt };
