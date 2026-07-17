import { safeFire, fireAndForget } from './utils/safeFire';
import https from 'https';
import { sendTelegramMessage } from './telegramClient';
import { logAgentMessage, getConfig, setConfig } from './agentDb';
import logger from './logger';

const AGENT_ROOM_TOPIC_ID = (): string | undefined => process.env['AGENT_ROOM_TOPIC_ID'];
const BOT_TOKEN           = (): string | undefined => process.env['TELEGRAM_BOT_TOKEN'];
const CHAT_ID             = (): string | undefined => process.env['TELEGRAM_CHAT_ID'];

const AGENT_EMOJI: Record<string, string> = {
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
const AGENT_LABELS: Record<string, string> = {
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
const AGENT_PERSONALITY: Record<string, string> = {
  nvidia:          'analytical and precise',
  qwen_coder:      'efficient and technical',
  qwen_coder_dash: 'fast and concise',
  gemini:          'thorough and detailed',
  qwen_max:        'strategic and thoughtful',
  llama_fast:      'brief and direct',
  qwen_turbo:      'rapid fire, minimal words',
  deepseek:        'methodical and careful',
};

function getEmoji(agentId: string): string {
  return AGENT_EMOJI[agentId] || '🤖';
}

// ── Low-level Telegram API ────────────────────────────────────────────────────

function telegramApiPost(method: string, body: any): Promise<any> {
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
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Telegram API timeout')); });
    req.write(bodyJson);
    req.end();
  });
}

async function answerCallback(queryId: string, text = ''): Promise<void> {
  if (!BOT_TOKEN()) return;
  await safeFire(telegramApiPost('answerCallbackQuery', {
    callback_query_id: queryId,
    text,
  }), { label: 'agentRoom' })
}

// ── Task 2 — AI personality message generation ────────────────────────────────

async function generatePersonalityMessage(agentId: string, baseMessage: string): Promise<string> {
  const personality = AGENT_PERSONALITY[agentId];
  if (!personality || !process.env['NVIDIA_API_KEY']) return baseMessage;

  try {
    const model    = process.env['CHAT_MODEL'] || 'meta/llama-3.1-70b-instruct';
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

    const result = await new Promise<any>((resolve, reject) => {
      const req = https.request({
        hostname: 'integrate.api.nvidia.com',
        path:     '/v1/chat/completions',
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(bodyJson),
          'Authorization':  `Bearer ${process.env['NVIDIA_API_KEY']}`,
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
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

async function announce(agentId: string, agentLabel: string, message: string, type = 'info', repoName: string | null = null): Promise<void> {
  const typeTag = type === 'warning' ? '⚠️ ' : type === 'error'   ? '❌ ' :
                  type === 'success' ? '✅ ' : type === 'handoff'  ? '🤝 ' : '';

  const fullMessage = `${typeTag}${message}`;

  // Phase 8.5 — send via the agent's own bot; falls back to Sentinel bot if token missing
  const { sendAsAgent } = require('./agentBots');
  await safeFire(sendAsAgent(agentId, fullMessage), { label: 'agentRoom' })

  await safeFire(logAgentMessage(agentId, agentLabel, message, type, repoName ?? undefined), { label: 'agentRoom' })
  logger.info({ agentId, type, repoName }, message);
}

// ── Announcement helpers (with personality) ───────────────────────────────────

async function announceStart(agentId: string, agentLabel: string, taskType: string, repoName: string, taskTitle: string): Promise<void> {
  const action      = taskType === 'audit' ? 'Starting audit on' : 'Building task on';
  const baseMessage = `${action} ${repoName} — "${taskTitle}"`;
  const message     = await generatePersonalityMessage(agentId, baseMessage).catch(() => baseMessage);
  await announce(agentId, agentLabel, message, 'info', repoName ?? undefined);
}

async function announceComplete(agentId: string, agentLabel: string, repoName: string, taskTitle: string, prUrl?: string): Promise<void> {
  const pr          = prUrl ? ` → ${prUrl}` : '';
  const baseMessage = `Finished "${taskTitle}" on ${repoName}${pr}`;
  const message     = await generatePersonalityMessage(agentId, baseMessage).catch(() => baseMessage);
  await announce(agentId, agentLabel, message, 'success', repoName);
}

async function announceConflict(agentId: string, agentLabel: string, repoName: string, conflicts: any[]): Promise<void> {
  const files = conflicts.map((c: any) => `${c.filePath} (locked by ${c.lockedBy})`).join(', ');
  // Conflict messages stay factual — no personality rewrite
  await announce(agentId, agentLabel, `File conflict on ${repoName} — skipping: ${files}`, 'warning', repoName);
}

// Improvement 2 — rich handoff with completed work, ready tasks, high-risk files, next task
async function announceHandoff(fromAgentId: string, fromLabel: string, toLabel: string, repoName: string, context: string, extras: any = {}): Promise<void> {
  const { completedTitle, readyCount, affectedFiles, nextTask } = extras;

  // Identify high-risk files from affected list
  let highRiskFiles: string[] = extras.highRiskFiles || [];
  if (!highRiskFiles.length && affectedFiles?.length) {
    const { assessRisk } = require('./riskAssessor');
    highRiskFiles = affectedFiles.filter((f: string) => assessRisk([f]) === 'High');
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

async function announceFailed(agentId: string, agentLabel: string, repoName: string, taskTitle: string, reason?: string): Promise<void> {
  const baseMessage = `Failed "${taskTitle}" on ${repoName} — ${reason?.substring(0, 100)}`;
  const message     = await generatePersonalityMessage(agentId, baseMessage).catch(() => baseMessage);
  await announce(agentId, agentLabel, message, 'error', repoName);
}

async function broadcastToAll(message: string): Promise<void> {
  await announce('sentinel', 'Sentinel', message, 'info', null);
}

// ── Improvement 4 — conflict resolution inline keyboard ──────────────────────

async function sendConflictKeyboard(agentId: string, agentLabel: string, repoName: string, conflicts: any[], conflictId: string): Promise<void> {
  if (!AGENT_ROOM_TOPIC_ID() || !BOT_TOKEN() || !CHAT_ID()) return;

  const fileList = conflicts.map((c: any) => `  · ${c.filePath} (held by ${c.lockedBy})`).join('\n');
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

  await safeFire(telegramApiPost('sendMessage', body), { label: 'agentRoom' })
}

// ── Improvement 1 — pinned status board ──────────────────────────────────────

async function buildStatusBoardText(): Promise<string> {
  const { getAllAgents, getRecentMessages } = require('./agentDb');
  const { query }                           = require('./dbClient');

  const [agents, messages] = await Promise.all([
    getAllAgents(),
    getRecentMessages(5),
  ]);

  const working = agents.filter((a: any) => a.status === 'working');
  const idle    = agents.filter((a: any) => a.status === 'idle');

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

  const agentLines = agents.map((a: any) => {
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

async function updatePinnedStatusBoard(): Promise<void> {
  if (!AGENT_ROOM_TOPIC_ID() || !BOT_TOKEN() || !CHAT_ID()) return;

  const text     = await buildStatusBoardText().catch(() => null);
  if (!text) return;

  const pinnedId = await getConfig('pinned_status_message_id').catch(() => null);

  if (pinnedId) {
    await safeFire(telegramApiPost('editMessageText', {
      chat_id:                  CHAT_ID(),
      message_id:               parseInt(pinnedId, 10),
      text:                     text.substring(0, 4000),
      parse_mode:               'HTML',
      disable_web_page_preview: true,
    }), { label: 'agentRoom' })
  } else {
    const result = await sendTelegramMessage(text, null, AGENT_ROOM_TOPIC_ID() ? parseInt(AGENT_ROOM_TOPIC_ID()!, 10) : null).catch(() => null);
    const messageId = result?.result?.message_id;
    if (messageId) {
      await safeFire(telegramApiPost('pinChatMessage', {
        chat_id:    CHAT_ID(),
        message_id: messageId,
      }), { label: 'agentRoom' })
      await safeFire(setConfig('pinned_status_message_id', String(messageId)), { label: 'agentRoom' })
    }
  }
}

// ── Improvement 5 — 8am agent room morning briefing ──────────────────────────

async function sendMorningBriefing(): Promise<void> {
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
    const focus   = summary?.metrics?.reduce((min: any, m: any) =>
      (!min || m.health_score < min.health_score) ? m : min, null
    );
    if (focus) focusLine = `🎯 Focus: ${focus.repo_name} (health ${focus.health_score}/10)`;
  } catch {}

  const idle    = agents.filter((a: any) => a.status === 'idle').length;
  const working = agents.filter((a: any) => a.status === 'working').length;
  const done24h = successRows.rows[0]?.count || 0;

  const queueLines = queueRows.rows.map((r: any) =>
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

  await safeFire(sendTelegramMessage(msg, null, AGENT_ROOM_TOPIC_ID() ? parseInt(AGENT_ROOM_TOPIC_ID()!, 10) : null), { label: 'agentRoom' })
}

// ── Summary for AI context ────────────────────────────────────────────────────

async function getAgentRoomSummary(): Promise<string> {
  const { getAllAgents, getRecentMessages } = require('./agentDb');
  const [agents, messages] = await Promise.all([
    getAllAgents(),
    getRecentMessages(10),
  ]);

  const working = agents.filter((a: any) => a.status === 'working');
  const idle    = agents.filter((a: any) => a.status === 'idle');
  const errored = agents.filter((a: any) => a.status === 'error');

  const agentLines = agents.map((a: any) => {
    const emoji  = getEmoji(a.agent_id);
    let status: string;
    if (a.status === 'working') {
      status = `working on ${a.repo_full_name?.split('/')[1]} — ${a.task_title?.substring(0, 40)}`;
    } else if (a.status === 'error') {
      status = `🔴 ERROR (${a.task_title || 'unknown reason'}) — needs attention`;
    } else {
      status = `idle (${a.completed_tasks} done)`;
    }
    return `${emoji} ${a.agent_label}: ${status}`;
  }).join('\n');

  const recentLines = messages.slice(-5).map((m: any) => {
    const emoji = getEmoji(m.agent_id);
    return `${emoji} ${m.agent_label}: ${m.message.substring(0, 80)}`;
  }).join('\n');

  return [
    `🛡️ Agent Room Status`,
    ``,
    `Active: ${working.length}  Idle: ${idle.length}${errored.length > 0 ? `  🔴 Error: ${errored.length}` : ''}`,
    ``,
    agentLines || 'No agents registered yet.',
    ``,
    `Recent activity:`,
    recentLines || 'No recent activity',
  ].join('\n');
}

export = {
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
