const { sendTelegramMessage } = require('./telegramClient');
const { logAgentMessage }     = require('./agentDb');
const logger                  = require('./logger');

const AGENT_ROOM_TOPIC_ID = () => process.env.AGENT_ROOM_TOPIC_ID;

const AGENT_EMOJI = {
  claude:          '🧠',
  nvidia:          '⚡',
  qwen_coder:      '🔧',
  qwen_coder_dash: '🔨',
  llama_fast:      '🚀',
  gemini:          '✨',
  qwen_max:        '💎',
  qwen_plus:       '🔵',
  qwen_turbo:      '⚡',
  deepseek:        '🌊',
  opencode:        '📝',
  sentinel:        '🛡️',
};

function getEmoji(agentId) {
  return AGENT_EMOJI[agentId] || '🤖';
}

async function announce(agentId, agentLabel, message, type = 'info', repoName = null) {
  const emoji   = getEmoji(agentId);
  const typeTag = type === 'warning' ? '⚠️ ' : type === 'error'   ? '❌ ' :
                  type === 'success' ? '✅ ' : type === 'handoff'  ? '🤝 ' : '';

  const fullMessage = `${emoji} ${agentLabel}: ${typeTag}${message}`;

  if (AGENT_ROOM_TOPIC_ID()) {
    await sendTelegramMessage(fullMessage, null, AGENT_ROOM_TOPIC_ID())
      .catch(() => {});
  }

  await logAgentMessage(agentId, agentLabel, message, type, repoName)
    .catch(() => {});

  logger.info({ agentId, type, repoName }, message);
}

async function announceStart(agentId, agentLabel, taskType, repoName, taskTitle) {
  const action = taskType === 'audit' ? 'Starting audit on' : 'Building task on';
  await announce(
    agentId, agentLabel,
    `${action} ${repoName} — "${taskTitle}"`,
    'info', repoName
  );
}

async function announceComplete(agentId, agentLabel, repoName, taskTitle, prUrl) {
  const pr = prUrl ? ` → ${prUrl}` : '';
  await announce(
    agentId, agentLabel,
    `Finished "${taskTitle}" on ${repoName}${pr}`,
    'success', repoName
  );
}

async function announceConflict(agentId, agentLabel, repoName, conflicts) {
  const files = conflicts.map(c => `${c.filePath} (locked by ${c.lockedBy})`).join(', ');
  await announce(
    agentId, agentLabel,
    `File conflict on ${repoName} — skipping: ${files}`,
    'warning', repoName
  );
}

async function announceHandoff(fromAgentId, fromLabel, toLabel, repoName, context) {
  await announce(
    fromAgentId, fromLabel,
    `Handing off ${repoName} to ${toLabel} — ${context}`,
    'handoff', repoName
  );
}

async function announceFailed(agentId, agentLabel, repoName, taskTitle, reason) {
  await announce(
    agentId, agentLabel,
    `Failed "${taskTitle}" on ${repoName} — ${reason?.substring(0, 100)}`,
    'error', repoName
  );
}

async function broadcastToAll(message) {
  await announce('sentinel', 'Sentinel', message, 'info', null);
}

async function getAgentRoomSummary() {
  const { getAllAgents, getRecentMessages } = require('./agentDb');
  const [agents, messages] = await Promise.all([
    getAllAgents(),
    getRecentMessages(10),
  ]);

  const working = agents.filter(a => a.status === 'working');
  const idle    = agents.filter(a => a.status === 'idle');

  const agentLines = agents.map(a => {
    const emoji  = getEmoji(a.agent_id);
    const status = a.status === 'working'
      ? `working on ${a.repo_full_name?.split('/')[1]} — ${a.task_title?.substring(0, 40)}`
      : `idle (${a.completed_tasks} done)`;
    return `${emoji} ${a.agent_label}: ${status}`;
  }).join('\n');

  const recentLines = messages.slice(-5).map(m => {
    const emoji = getEmoji(m.agent_id);
    return `${emoji} ${m.agent_label}: ${m.message.substring(0, 80)}`;
  }).join('\n');

  return [
    `🛡️ Agent Room Status`,
    ``,
    `Active: ${working.length}  Idle: ${idle.length}`,
    ``,
    agentLines || 'No agents registered yet.',
    ``,
    `Recent activity:`,
    recentLines || 'No recent activity',
  ].join('\n');
}

module.exports = {
  announce,
  announceStart,
  announceComplete,
  announceConflict,
  announceHandoff,
  announceFailed,
  broadcastToAll,
  getAgentRoomSummary,
};
