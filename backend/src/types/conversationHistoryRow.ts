// Real row shape for getHistory()'s SELECT projection over
// conversation_history (see conversationMemory.ts's schema init).
// Standalone module because conversationMemory.ts uses `export =`.

export interface ConversationHistoryRow {
  from_name: string;
  message: string;
  response: string | null;
  agent_id: string | null;
  created_at: string;
}
