// Phase 7 of docs/2026-07-22-slack-agent-roster-plan.md — command surface
// for starting a roundtable. See backend/src/agents/roundtable.ts for the
// fan-out/collection/synthesis logic and its honesty notes (untested
// against real Slack).

import { sendTelegramMessage } from '../telegramClient';
import { startRoundtable } from '../agents/roundtable';

async function handleRoundtableCmd(
  subcommand: string,
  parts: string[],
  _chatId: string | null,
  topicId: number | null
): Promise<boolean> {
  if (subcommand !== 'roundtable') return false;

  const [repo, ...questionWords] = parts.slice(2);
  const question = questionWords.join(' ');
  if (!repo || !question) {
    await sendTelegramMessage('Usage: roundtable <repo> <question>', null, topicId);
    return true;
  }

  const result = await startRoundtable(repo, question);
  await sendTelegramMessage(
    result.ok
      ? `🗣️ Roundtable started in ${repo}'s Slack channel: "${question}"`
      : `⚠️ Could not start roundtable — ${result.reason}`,
    repo, topicId
  );
  return true;
}

export { handleRoundtableCmd };
