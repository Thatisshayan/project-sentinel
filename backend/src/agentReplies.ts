import logger from './logger';
import { sendAsAgent } from './agentBots';
import { handleMessage } from './telegramAI';

// Telegram bot username (lowercase, no @) → agent ID
const BOT_USERNAME_TO_AGENT: Record<string, string> = {
  nemotronsintel:        'nvidia',          // @nemotronsintelbot
  qwencodersintenel:     'qwen_coder',      // @qwencodersintenelbot (typo in username)
  qwendashsentinel:      'qwen_coder_dash', // @qwendashsentinelbot
  geminisentinel:        'gemini',          // @geminisentinelbot
  deepseeksentinel:      'deepseek',        // @deepseeksentinelBot
  // qwen_max, qwen_turbo, llama_fast — bots not yet created, fall back to Sentinel bot
};

// Returns agent ID if the message is a reply to a specific agent bot, else null
function detectAgentReply(message: any): string | null {
  const replyTo = message?.reply_to_message;
  if (!replyTo) return null;

  const botUsername = replyTo.from?.username?.toLowerCase();
  if (!botUsername) return null;

  // Strip trailing 'bot' suffix if present (e.g. sentinelnemotronbot → sentinelnemotron)
  const normalized = botUsername.replace(/bot$/, '');
  return BOT_USERNAME_TO_AGENT[normalized] || BOT_USERNAME_TO_AGENT[botUsername] || null;
}

// Route a message that is a reply to a specific agent
async function handleAgentReply(message: any, agentId: string, topicId: number): Promise<void> {
  const text      = message.text || '';
  const fromName  = message.from?.first_name || message.from?.username || 'Shayan';
  const messageId = message.message_id;

  logger.info({ agentId, text: text.substring(0, 80) }, 'Direct agent reply received');

  try {
    const { getAgentRoomSummary } = require('./agentRoom');
    const { getAllAgents }         = require('./agentDb');

    const [agents] = await Promise.all([
      getAllAgents().catch(() => []),
    ]);

    const thisAgent = agents.find((a: any) => a.agent_id === agentId);

    const agentContext = thisAgent
      ? `You are specifically being addressed as ${thisAgent.agent_label}. ` +
        `Your current status: ${thisAgent.status}. ` +
        (thisAgent.task_title
          ? `You are working on: ${thisAgent.task_title}`
          : 'You are currently idle.')
      : `You are being directly addressed as agent: ${agentId}`;

    // handleMessage(text, fromName, topicId, roomContext, targetAgentId, agentContext, replyToMessageId)
    await handleMessage(text, fromName, topicId, undefined, agentId as any, agentContext as any, messageId);

  } catch (err: any) {
    logger.error({ err: err.message, agentId }, 'Agent reply handling failed');
    await sendAsAgent(
      agentId,
      'Sorry, I had trouble processing that. Try again or use /sentinel agents.',
      messageId
    ).catch(() => {});
  }
}

export = { detectAgentReply, handleAgentReply };
