const https               = require('https');
const { sendTelegramMessage } = require('./telegramClient');
const { logAgentMessage, getConfig, setConfig } = require('./agentDb');
const logger              = require('./logger');

const AGENT_ROOM_TOPIC_ID = () => process.env.AGENT_ROOM_TOPIC_ID;
const BOT_TOKEN           = () => process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID             = () => process.env.TELEGRAM_CHAT_ID;

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

// Bot username suffixes — used by agentBots.js for @mention routing
const AGENT_LABELS = {
  nvidia:          'Nemotron',
  qwen_coder:      'QwenCoder',
  qwen_coder_dash: 'QwenDash',
  gemini:          'Gemini',
  qwen_max:        'QwenMax',
  qwen_turbo:      'QwenTurbo',
  llama_fast:      'Llama',
  deepseek:        'DeepSeek',
};

// Task 2 — each agent has a distinct communication style
const AGENT_PERSONALITY = {
  nvidia:          'analytical and precise',
  qwen_coder:      'efficient and technical',
  qwen_coder_dash: 'fast and concise',
  gemini:          'thorough and detailed',
  qwen_max:        'strategic and thoughtful',
  llama_fast:      'brief and direct',
  qwen_turbo:      'rapid fire, minimal words',
  deepseek:        'methodical and careful',
};

function getEmoji(agentId) {
  return AGENT_EMOJI[agentId] || '🤖';
}

// ── Low-level Telegram API ────────────────────────────────────────────────────

function telegramApiPost(method, body) {
  return new Promise((resolve, reject) => {
    if (!BOT_TOKEN()) { resolve(null); return; }
    const bodyJson = JSON.stringify(body);
    const options  = {
      hostname: 'api.telegram.org',
      path:     `/bot${BOT_TOKEN()}/${method}`,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyJson),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Telegram API timeout')); });
    req.write(bodyJson);
    req.end();
  });
}

async function answerCallback(queryId, text = '') {
  if (!BOT_TOKEN()) return;
  await telegramApiPost('answerCallbackQuery', {
    callback_query_id: queryId,
    text,
  }).catch(() => {});
}

// ── Task 2 — AI personality message generation ────────────────────────────────

async function generatePersonalityMessage(agentId, baseMessage) {
  const personality = AGENT_PERSONALITY[agentId];
  if (!personality || !process.env.NVIDIA_API_KEY) return baseMessage;

  try {
    const model    = process.env.CHAT_MODEL || 'meta/llama-3.3-70b-instruct';
    const bodyJson = JSON.stringify({
      model,
      messages: [
        {
          role:    'system',
          content: `You are ${agentId}, an AI coding agent. Your communication style is ${personality}. Rewrite the status update below in your voice. Under 3 sentences. No greeting. Output only the rewritten message.`,
        },
        { role: 'user', content: baseMessage },
      ],
      max_tokens:  100,
      temperature: 0.7,
    });

    const result = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'integrate.api.nvidia.com',
        path:     '/v1/chat/completions',
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(bodyJson),
          'Authorization':  `Bearer ${process.env.NVIDIA_API_KEY}`,
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
      });
      req.on('error', reject);
      req.setTimeout(8000, () => { req.destroy(); reject(new Error('NIM timeout')); });
      req.write(bodyJson);
      req.end();
    });

    return result?.choices?.[0]?.message?.content?.trim() || baseMessage;
  } catch {
    return baseMessage;
  }
}

// ── Core announce ─────────────────────────────────────────────────────────────

async function announce(agentId, agentLabel, message, type = 'info', repoName = null) {
  const typeTag = type === 'warning' ? '⚠️ ' : type === 'error'   ? '❌ ' :
                  type === 'success' ? '✅ ' : type === 'handoff'  ? '🤝 ' : '';

  const fullMessage = `${typeTag}${message}`;

  // Phase 8.5 — send via the agent's own bot; falls back to Sentinel bot if token missing
  const { sendAsAgent } = require('./agentBots');
  await sendAsAgent(agentId, fullMessage).catch(() => {});

  await logAgentMessage(agentId, agentLabel, message, type, repoName).catch(() => {});
  logger.info({ agentId, type, repoName }, message);
}

// ── Announcement helpers (with personality) ───────────────────────────────────

async function announceStart(agentId, agentLabel, taskType, repoName, taskTitle) {
  const action      = taskType === 'audit' ? 'Starting audit on' : 'Building task on';
  const baseMessage = `${action} ${repoName} — "${taskTitle}"`;
  const message     = await generatePersonalityMessage(agentId, baseMessage).catch(() => baseMessage);
  await announce(agentId, agentLabel, message, 'info', repoName);
}

async function announceComplete(agentId, agentLabel, repoName, taskTitle, prUrl) {
  const pr          = prUrl ? ` → ${prUrl}` : '';
  const baseMessage = `Finished "${taskTitle}" on ${repoName}${pr}`;
  const message     = await generatePersonalityMessage(agentId, baseMessage).catch(() => baseMessage);
  await announce(agentId, agentLabel, message, 'success', repoName);
}

async function announceConflict(agentId, agentLabel, repoName, conflicts) {
  const files = conflicts.map(c => `${c.filePath} (locked by ${c.lockedBy})`).join(', ');
  // Conflict messages stay factual — no personality rewrite
  await announce(agentId, agentLabel, `File conflict on ${repoName} — skipping: ${files}`, 'warning', repoName);
}

// Improvement 2 — rich handoff with completed work, ready tasks, high-risk files, next task
async function announceHandoff(fromAgentId, fromLabel, toLabel, repoName, context, extras = {}) {
  const { completedTitle, readyCount, affectedFiles, nextTask } = extras;

  // Identify high-risk files from affected list
  let highRiskFiles = extras.highRiskFiles || [];
  if (!highRiskFiles.length && affectedFiles?.length) {
    const { assessRisk } = require('./riskAssessor');
    highRiskFiles = affectedFiles.filter(f => assessRisk([f]) === 'High');
  }

  const parts = [`Handing off ${repoName} to ${toLabel}`];
  if (context)              parts.push(context);
  if (completedTitle)       parts.push(`Completed: "${completedTitle}"`);
  if (readyCount > 0)       parts.push(`${readyCount} task(s) ready`);
  if (highRiskFiles.length) parts.push(`Watch: ${highRiskFiles.slice(0, 3).join(', ')}`);
  if (nextTask)             parts.push(`First task: "${nextTask}"`);

  const baseMessage = parts.join(' — ');
  const message     = await generatePersonalityMessage(fromAgentId, baseMessage).catch(() => baseMessage);
  await announce(fromAgentId, fromLabel, message, 'handoff', repoName);
}

async function announceFailed(agentId, agentLabel, repoName, taskTitle, reason) {
  const baseMessage = `Failed "${taskTitle}" on ${repoName} — ${reason?.substring(0, 100)}`;
  const message     = await generatePersonalityMessage(agentId, baseMessage).catch(() => baseMessage);
  await announce(agentId, agentLabel, message, 'error', repoName);
}

async function broadcastToAll(message) {
  await announce('sentinel', 'Sentinel', message, 'info', null);
}

// ── Improvement 4 — conflict resolution inline keyboard ──────────────────────

async function sendConflictKeyboard(agentId, agentLabel, repoName, conflicts, conflictId) {
  if (!AGENT_ROOM_TOPIC_ID() || !BOT_TOKEN() || !CHAT_ID()) return;

  const fileList = conflicts.map(c => `  · ${c.filePath} (held by ${c.lockedBy})`).join('\n');
  const text     = `⚠️ ${getEmoji(agentId)} ${agentLabel}: File conflict on ${repoName}\n\n${fileList}\n\nHow should this be resolved?`;

  const body = {
    chat_id:                  CHAT_ID(),
    message_thread_id:        AGENT_ROOM_TOPIC_ID(),
    text:                     text.substring(0, 4000),
    parse_mode:               'HTML',
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [[
        { text: 'Wait ⏳',      callback_data: `conflict:wait:${conflictId}` },
        { text: 'Skip file ⏭️', callback_data: `conflict:skip:${conflictId}` },
        { text: 'Reassign 🔄', callback_data: `conflict:reassign:${conflictId}` },
      ]],
    },
  };

  await telegramApiPost('sendMessage', body).catch(() => {});
}

// ── Improvement 1 — pinned status board ──────────────────────────────────────

async function buildStatusBoardText() {
  const { getAllAgents, getRecentMessages } = require('./agentDb');
  const { query }                           = require('./dbClient');

  const [agents, messages] = await Promise.all([
    getAllAgents(),
    getRecentMessages(5),
  ]);

  const working = agents.filter(a => a.status === 'working');
  const idle    = agents.filter(a => a.status === 'idle');

  const queueR = await query(
    `SELECT COUNT(*) as count FROM audit_tasks WHERE status IN ('queued','in_progress')`
  ).catch(() => ({ rows: [{ count: 0 }] }));
  const queueCount = queueR.rows[0]?.count || 0;

  let sprintLine = '';
  try {
    const { getCurrentSprint } = require('./sprintDb');
    const sprint = await getCurrentSprint();
    if (sprint) {
      const total  = Math.max(sprint.total_tasks || 1, 1);
      const done   = sprint.completed_tasks || 0;
      const pct    = Math.round((done / total) * 100);
      const filled = Math.round(pct / 10);
      sprintLine = `Sprint: [${'█'.repeat(filled)}${'░'.repeat(10 - filled)}] ${pct}% (${done}/${total})`;
    }
  } catch {}

  const agentLines = agents.map(a => {
    const emoji  = getEmoji(a.agent_id);
    const status = a.status === 'working'
      ? `⚡ ${a.repo_full_name?.split('/')[1]} — ${a.task_title?.substring(0, 35)}`
      : '💤 idle';
    return `${emoji} ${a.agent_label}: ${status}`;
  }).join('\n');

  const now = new Date().toLocaleString('en-CA', {
    timeZone: 'America/Toronto', hour12: false,
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return [
    `🛡️ Agent Room — Live Status`,
    `Updated: ${now} ET`,
    ``,
    `Active: ${working.length}  Idle: ${idle.length}  Queued: ${queueCount}`,
    sprintLine,
    ``,
    agentLines || 'No agents registered.',
  ].filter(Boolean).join('\n');
}

async function updatePinnedStatusBoard() {
  if (!AGENT_ROOM_TOPIC_ID() || !BOT_TOKEN() || !CHAT_ID()) return;

  const text     = await buildStatusBoardText().catch(() => null);
  if (!text) return;

  const pinnedId = await getConfig('pinned_status_message_id').catch(() => null);

  if (pinnedId) {
    await telegramApiPost('editMessageText', {
      chat_id:                  CHAT_ID(),
      message_id:               parseInt(pinnedId, 10),
      text:                     text.substring(0, 4000),
      parse_mode:               'HTML',
      disable_web_page_preview: true,
    }).catch(() => {});
  } else {
    const result = await sendTelegramMessage(text, null, AGENT_ROOM_TOPIC_ID()).catch(() => null);
    const messageId = result?.result?.message_id;
    if (messageId) {
      await telegramApiPost('pinChatMessage', {
        chat_id:    CHAT_ID(),
        message_id: messageId,
      }).catch(() => {});
      await setConfig('pinned_status_message_id', String(messageId)).catch(() => {});
    }
  }
}

// ── Improvement 5 — 8am agent room morning briefing ──────────────────────────

async function sendMorningBriefing() {
  if (!AGENT_ROOM_TOPIC_ID()) return;

  const { getAllAgents } = require('./agentDb');
  const { query }        = require('./dbClient');

  const [agents, queueRows, successRows] = await Promise.all([
    getAllAgents().catch(() => []),
    query(`
      SELECT repo_full_name, COUNT(*) as count
      FROM audit_tasks
      WHERE status IN ('queued','in_progress')
      GROUP BY repo_full_name
      ORDER BY count DESC
      LIMIT 5
    `).catch(() => ({ rows: [] })),
    query(`
      SELECT COUNT(*) as count FROM agent_messages
      WHERE message_type = 'success'
        AND created_at >= NOW() - INTERVAL '24 hours'
    `).catch(() => ({ rows: [{ count: 0 }] })),
  ]);

  let sprintLine = '';
  try {
    const { getCurrentSprint } = require('./sprintDb');
    const sprint = await getCurrentSprint();
    if (sprint) {
      const total  = Math.max(sprint.total_tasks || 1, 1);
      const done   = sprint.completed_tasks || 0;
      const pct    = Math.round((done / total) * 100);
      const filled = Math.round(pct / 10);
      sprintLine = `Sprint: [${'█'.repeat(filled)}${'░'.repeat(10 - filled)}] ${pct}% (${done}/${total})`;
    }
  } catch {}

  let focusLine = '';
  try {
    const { getPortfolioSummary } = require('./portfolioAnalytics');
    const summary = await getPortfolioSummary();
    const focus   = summary?.metrics?.reduce((min, m) =>
      (!min || m.health_score < min.health_score) ? m : min, null
    );
    if (focus) focusLine = `🎯 Focus: ${focus.repo_name} (health ${focus.health_score}/10)`;
  } catch {}

  const idle    = agents.filter(a => a.status === 'idle').length;
  const working = agents.filter(a => a.status === 'working').length;
  const done24h = successRows.rows[0]?.count || 0;

  const queueLines = queueRows.rows.map(r =>
    `  · ${r.repo_full_name.split('/')[1]}: ${r.count} tasks`
  ).join('\n');

  const msg = [
    `🌅 Good morning — Agent Room Briefing`,
    ``,
    `📊 Last 24h: ${done24h} tasks completed`,
    ``,
    `📋 Today's queue:`,
    queueLines || '  No tasks queued',
    ``,
    sprintLine || 'No active sprint',
    ``,
    `🤖 Agents: ${idle} idle, ${working} working`,
    focusLine,
  ].filter(Boolean).join('\n');

  await sendTelegramMessage(msg, null, AGENT_ROOM_TOPIC_ID()).catch(() => {});
}

// ── Summary for AI context ────────────────────────────────────────────────────

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
  AGENT_EMOJI,
  AGENT_LABELS,
  announce,
  announceStart,
  announceComplete,
  announceConflict,
  announceHandoff,
  announceFailed,
  broadcastToAll,
  getAgentRoomSummary,
  sendConflictKeyboard,
  answerCallback,
  updatePinnedStatusBoard,
  sendMorningBriefing,
};
