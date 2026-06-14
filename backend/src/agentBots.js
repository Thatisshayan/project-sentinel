const https  = require('https');
const logger = require('./logger');

// Per-agent bot tokens — set in Railway Variables
const AGENT_BOT_TOKENS = () => ({
  nvidia:          process.env.BOT_TOKEN_NEMOTRON,
  qwen_coder:      process.env.BOT_TOKEN_QWEN_CODER,
  qwen_coder_dash: process.env.BOT_TOKEN_QWEN_DASH,
  gemini:          process.env.BOT_TOKEN_GEMINI,
  qwen_max:        process.env.BOT_TOKEN_QWEN_MAX,
  qwen_turbo:      process.env.BOT_TOKEN_QWEN_TURBO,
  llama_fast:      process.env.BOT_TOKEN_LLAMA,
  deepseek:        process.env.BOT_TOKEN_DEEPSEEK,
  sentinel:        process.env.TELEGRAM_BOT_TOKEN,
});

const CHAT_ID  = () => process.env.TELEGRAM_CHAT_ID;
const TOPIC_ID = () => process.env.AGENT_ROOM_TOPIC_ID;
const MAX_LEN  = 4096;

// Send a message from a specific agent's own bot token
async function sendAsAgent(agentId, text, replyToMessageId = null) {
  const tokens = AGENT_BOT_TOKENS();
  const token  = tokens[agentId];

  if (!token) {
    return sendViaSentinel(agentId, text);
  }

  if (!CHAT_ID()) {
    logger.warn({ agentId }, 'TELEGRAM_CHAT_ID not set — cannot send agent message');
    return null;
  }

  const safeText = text.length > MAX_LEN
    ? text.substring(0, MAX_LEN - 20) + '\n[truncated]'
    : text;

  const body = JSON.stringify({
    chat_id:                  CHAT_ID(),
    text:                     safeText,
    parse_mode:               'HTML',
    disable_web_page_preview: true,
    message_thread_id:        TOPIC_ID() ? parseInt(TOPIC_ID()) : undefined,
    reply_to_message_id:      replyToMessageId || undefined,
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.telegram.org',
      path:     `/bot${token}/sendMessage`,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.ok) {
            resolve({ messageId: parsed.result?.message_id, agentId });
          } else {
            logger.warn({ agentId, error: parsed.description }, 'Agent bot send failed — falling back');
            sendViaSentinel(agentId, text).then(resolve).catch(() => resolve(null));
          }
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => {
      sendViaSentinel(agentId, text).then(resolve).catch(() => resolve(null));
    });

    req.setTimeout(10000, () => {
      req.destroy();
      resolve(null);
    });

    req.write(body);
    req.end();
  });
}

// Fallback — send via main Sentinel bot with emoji prefix
async function sendViaSentinel(agentId, text) {
  const { sendTelegramMessage } = require('./telegramClient');
  // Lazy require to avoid circular dependency with agentRoom
  const agentRoom = require('./agentRoom');
  const emoji = (agentRoom.AGENT_EMOJI || {})[agentId] || '🤖';
  return sendTelegramMessage(`${emoji} ${text}`, null, TOPIC_ID()).catch(() => null);
}

// Reply to a specific message from an agent's own bot
async function replyAsAgent(agentId, replyToMessageId, text) {
  return sendAsAgent(agentId, text, replyToMessageId);
}

// Agent addresses another agent by @mention
async function agentToAgent(fromAgentId, toAgentId, text) {
  // Lazy require to avoid circular dependency with agentRoom
  const agentRoom = require('./agentRoom');
  const labels    = agentRoom.AGENT_LABELS || {};
  const toLabel   = labels[toAgentId] || toAgentId;
  const fullText  = `@Sentinel${toLabel.replace(/\s+/g, '')}: ${text}`;
  return sendAsAgent(fromAgentId, fullText);
}

// Check which agent bots have tokens configured
function getConfiguredBots() {
  const tokens     = AGENT_BOT_TOKENS();
  const configured = [];
  const missing    = [];

  for (const [agentId, token] of Object.entries(tokens)) {
    if (agentId === 'sentinel') continue;
    if (token) configured.push(agentId);
    else missing.push(agentId);
  }

  return { configured, missing };
}

// Set bot description via Telegram API
async function configureBotProfile(agentId, description) {
  const tokens = AGENT_BOT_TOKENS();
  const token  = tokens[agentId];
  if (!token) return;

  const body    = JSON.stringify({ description });
  const options = {
    hostname: 'api.telegram.org',
    path:     `/bot${token}/setMyDescription`,
    method:   'POST',
    headers:  {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      res.on('data', () => {});
      res.on('end', resolve);
    });
    req.on('error', resolve);
    req.write(body);
    req.end();
  });
}

module.exports = {
  sendAsAgent,
  replyAsAgent,
  agentToAgent,
  getConfiguredBots,
  configureBotProfile,
};
