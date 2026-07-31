// Slack Events API event shape — deliberately loose/partial since this
// covers app_mention, message, and bot_message subtypes with different
// field sets. Shared between slackEvents.ts, viktorWatcher.ts, and
// roundtable.ts's message-event consumers.

export interface SlackEvent {
  type?: string;
  subtype?: string;
  text?: string;
  channel?: string;
  user?: string;
  username?: string;
  bot_id?: string;
  thread_ts?: string;
  ts?: string;
}

export interface SlackEventPayload {
  type?: string;
  challenge?: string;
  event?: SlackEvent;
}
