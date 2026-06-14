const logger = require('./logger');
const { sendAsAgent } = require('./agentBots');
const { handleMessage } = require('./telegramAI');

// Telegram bot username (lowercase, no @) → agent ID
const BOT_USERNAME_TO_AGENT = {
  sentinelnemotron:  'nvidia',
  sentinelqwencoder: 'qwen_coder',
  sentinelqwendash:  'qwen_coder_dash',
  sentinelgemini:    'gemini',
  sentinelqwenmax:   'qwen_max',
  sentinelqwenturbo: 'qwen_turbo',
  sentinelllama:     'llama_fast',
  sentineldeepseek:  'deepseek',
};

// Returns agent ID if the message is a reply to a specific agent bot, else null
function detectAgentReply(message) {
  const replyTo = message?.reply_to_message;
  if (!replyTo) return null;

  const botUsername = replyTo.from?.username?.toLowerCase();
  if (!botUsername) return null;

  // Strip trailing 'bot' suffix if present (e.g. sentinelnemotronbot → sentinelnemotron)
  const normalized = botUsername.replace(/bot$/, '');
  return BOT_USERNAME_TO_AGENT[normalized] || BOT_USERNAME_TO_AGENT[botUsername] || null;
}

// Route a message that is a reply to a specific agent
async function handleAgentReply(message, agentId, topicId) {
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

    const thisAgent = agents.find(a => a.agent_id === agentId);

    const agentContext = thisAgent
      ? `You are specifically being addressed as ${thisAgent.agent_label}. ` +
        `Your current status: ${thisAgent.status}. ` +
        (thisAgent.task_title
          ? `You are working on: ${thisAgent.task_title}`
          : 'You are currently idle.')
      : `You are being directly addressed as agent: ${agentId}`;

    // handleMessage(text, fromName, topicId, roomContext, targetAgentId, agentContext, replyToMessageId)
    await handleMessage(text, fromName, topicId, null, agentId, agentContext, messageId);

  } catch (err) {
    logger.error({ err: err.message, agentId }, 'Agent reply handling failed');
    await sendAsAgent(
      agentId,
      'Sorry, I had trouble processing that. Try again or use /sentinel agents.',
      messageId
    ).catch(() => {});
  }
}

module.exports = { detectAgentReply, handleAgentReply };
