import { safeFire, fireAndForget } from './utils/safeFire';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import logger from './logger';
import { repoFullName } from './repoResolver';
import { getPortfolioSummary } from './portfolioAnalytics';
import { getOpenPatterns, getDailyCost, getMonthlyCost } from './portfolioDb';
import { sendTelegramMessage } from './telegramClient';
import { trackChatCost } from './costTracker';
import { sendDailyReport } from './dailyReport';
import { updateDashboard } from './notionDashboard';
import {
  executeApprovedTasks,
  triggerAudit,
} from './auditOrchestrator';
import { stopAllTasksForRepo } from './auditDb';
import { approveSprint, getSprintStatus } from './sprintOrchestrator';
import { getVelocityReport } from './velocityTracker';
import { getAgentRoomSummary } from './agentRoom';
import { setAgentIdle, getAllAgents } from './agentDb';
import { getDefaultBranch } from './repoDiscovery';
import { findNotionProject, updateBuilderAgent } from './notionClient';
import { saveMessage, getHistory, formatHistoryForPrompt } from './conversationMemory';

const CHAT_MODEL = process.env['CHAT_MODEL'] || 'mistralai/mistral-nemotron';

async function storeRedisContext(topicId: number | null, sender: string, message: string): Promise<void> {
  try {
    const { getRedisConnection } = require('./queueClient');
    const redis = getRedisConnection();
    if (!redis) return;
    const key = `sentinel:context:${topicId || 'general'}`;
    await redis.lpush(key, `[${sender}] ${message.substring(0, 200)}`);
    await redis.ltrim(key, 0, 9);
    await redis.expire(key, 3600);
  } catch (e: any) {
    logger.warn({ err: e.message }, 'Redis context store failed');
  }
}

async function getRedisContext(topicId: number | null): Promise<string[]> {
  try {
    const { getRedisConnection } = require('./queueClient');
    const redis = getRedisConnection();
    if (!redis) return [];
    const key = `sentinel:context:${topicId || 'general'}`;
    const messages = await redis.lrange(key, 0, 9);
    return messages.reverse(); // oldest first
  } catch (e: any) {
    logger.warn({ err: e.message }, 'Redis context fetch failed');
    return [];
  }
}

// Normalize AI-generated repo names (e.g. "projectSentinel") to canonical kebab names
function resolveRepoName(input: string): any {
  const { canonicalizeRepoName } = require('./repoResolver');
  return canonicalizeRepoName(input);
}

// Pick which agent should "speak" for a given message in the agent room
function pickSpeakingAgent(messageText: string): string {
  const t = messageText.toLowerCase();
  if (/\b(code|fix|build|pr|implement|function|bug|error)\b/.test(t)) return 'qwen_coder';
  // Prefix (stem) matching is intentional only for analy/secur/debug/fail —
  // full words like "analyze"/"analysis"/"security"/"debugging"/"failed"
  // continue past a trailing \b, so it can't be used there (see regression
  // test in telegramAI.pickSpeakingAgent.test.ts). The other terms in each
  // group (audit/review/score/report, broke/crash/log) are already complete
  // words with no such continuation problem, so they keep \b on both sides
  // to avoid over-matching unrelated words like "reporter"/"scorecard"/
  // "reviewable"/"crashpad".
  if (/\b(audit|analy\w*|review|secur\w*|score|report)\b/.test(t))     return 'nvidia';
  if (/\b(debug\w*|fail\w*|broke|crash|log)\b/.test(t))                return 'gemini';
  if (/\b(fast|quick|simple|check|status)\b/.test(t))                  return 'deepseek';
  return 'nvidia'; // Nemotron is the default speaker
}

const SYSTEM_PROMPT = `You are Project Sentinel, an autonomous DevOps AI managing a portfolio of 12 GitHub repositories for a solo founder named Shayan based in Toronto.

You have full visibility into all repos, their build status, pending tasks, and recent activity. You can take actions on Shayan's behalf.

AVAILABLE ACTIONS (respond with JSON action objects):
- { "action": "execute_tasks", "repo": "<repoName>" }
- { "action": "trigger_audit", "repo": "<repoName>" }
- { "action": "stop_repo", "repo": "<repoName>" }
- { "action": "send_report" }
- { "action": "show_costs" }
- { "action": "approve_sprint" }
- { "action": "sprint_status" }
- { "action": "velocity_report" }
- { "action": "show_agents" }
- { "action": "agent_status", "agent": "<agentId>" }
- { "action": "assign_repo", "repo": "<repoName>", "agent": "<agentId>" }
- { "action": "stop_agent", "agent": "<agentId>" }
- { "action": "create_task", "repo": "<repoName>", "title": "<task title>", "description": "<detailed description>", "priority": "critical|high|medium|low" }
- { "action": "answer", "message": "<your response>" }

NATURAL LANGUAGE TRIGGERS:
- "assign <repo> to <agent>"         → action: assign_repo
- "swap <repo> to <agent>"           → action: assign_repo
- "what is <agent> doing?"           → action: agent_status
- "what is <agent> working on?"      → action: agent_status
- "stop <agent>"                     → action: stop_agent
- "add dark mode to <repo>"          → action: create_task (convert the request to a concrete task)
- "fix the login bug in <repo>"      → action: create_task
- "I need <feature> in <repo>"       → action: create_task
- "build <feature>"                  → action: create_task
- "start working on <repo>"          → action: execute_tasks
- "run the tasks for <repo>"         → action: execute_tasks
- "execute <repo>"                   → action: execute_tasks
- "go on <repo>"                     → action: execute_tasks
- "<agent> work on <repo>"           → action: execute_tasks
- "start the task for <repo>"        → action: execute_tasks
- "<agent> start <repo>"             → action: execute_tasks
- "audit <repo>"                     → action: trigger_audit
- "good morning" / "morning"         → action: send_report
- "what needs attention?"            → action: send_report
- "what's urgent?" / "what's broken" → action: send_report
- "daily update" / "status update"   → action: send_report
- "what are we working on?"          → action: show_agents
- "who is working?"                  → action: show_agents
- "how much have we spent?"          → action: show_costs
- "cost update"                      → action: show_costs

REPO NAMES (always use exact spelling in the "repo" field — never invent camelCase):
acc, tapcash, AlphonsoEcosystem, session-guard, costpilot, shiporex, aegis, mint, agents-ops-board, founder-social-club, obsidian-studio, obsidian-media, project-sentinel

AGENT IDs: nvidia, qwen_coder, qwen_coder_dash, llama_fast, gemini, qwen_max, qwen_plus, qwen_turbo, deepseek, opencode

AGENT PERSONALITIES:
- nvidia (Nemotron):  Deep reasoning, audit analysis, portfolio intelligence
- qwen_coder:         Code specialist, PR author, implementation tasks
- gemini:             Debugging, log analysis, creative problem-solving
- deepseek:           Fast execution, routine tasks, quick lookups
- llama_fast:         Ultra fast, low complexity batch tasks

RULES:
1. Always respond with a JSON object containing an "action" field.
2. For questions or information requests, use action: "answer".
3. Never take destructive actions without explicit instruction.
4. Be concise. Shayan is busy. No fluff.
5. If asked about a specific repo, focus on that repo's data.
6. If asked to "focus on" or "prioritize" a repo, execute its tasks.
7. Address Shayan by name occasionally but not every message.
8. Tone: direct, confident, like a sharp technical co-founder.
9. When AGENT ROOM CONTEXT is provided, you know exactly what every agent is doing right now — use it.

Respond ONLY with valid JSON. No preamble. No markdown.`;

async function buildContext(): Promise<string> {
  try {
    const [summary, patterns, dailyCost, monthlyCost] = await Promise.all([
      getPortfolioSummary(),
      getOpenPatterns(),
      getDailyCost(),
      getMonthlyCost(),
    ]);

    const repoStates = summary.metrics.map((m: any) =>
      `${m.repo_name}: health=${m.health_score}/10 status=${m.build_status} priority=${m.priority} tasks_queued=${m.tasks_queued}`
    ).join('\n');

    return `CURRENT PORTFOLIO STATE:
Health average: ${summary.avgHealth}/10
Healthy repos: ${summary.healthy.length}
Broken repos: ${summary.broken.length} — ${summary.broken.map((m: any) => m.repo_name).join(', ')}

REPO DETAILS:
${repoStates}

PATTERNS DETECTED: ${patterns.length}
${patterns.slice(0, 3).map((p: any) => `- ${p.description} (${(p.affected_repos || []).length} repos)`).join('\n')}

API COSTS: $${dailyCost.toFixed(2)} today, $${monthlyCost.toFixed(2)} this month`;
  } catch {
    return 'Portfolio context unavailable — database may be initialising.';
  }
}

// Calls the best available AI provider in priority order.
// Never uses Anthropic unless explicitly set — free providers first.
async function callChatAPI(prompt: string): Promise<string> {
  if (process.env['NVIDIA_API_KEY']) {
    const response = await axios.post(
      'https://integrate.api.nvidia.com/v1/chat/completions',
      {
        model:       CHAT_MODEL,
        messages:    [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: prompt },
        ],
        max_tokens:  1000,
        temperature: 0.3,
      },
      {
        headers: { Authorization: `Bearer ${process.env['NVIDIA_API_KEY']}`, 'Content-Type': 'application/json' },
        timeout: 30000,
      }
    );
    return response.data.choices[0]?.message?.content || '';
  }

  if (process.env['GEMINI_API_KEY']) {
    const response = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      {
        model:      'gemini-2.0-flash',
        messages:   [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt }],
        max_tokens: 1000,
      },
      {
        headers: { Authorization: `Bearer ${process.env['GEMINI_API_KEY']}`, 'Content-Type': 'application/json' },
        timeout: 30000,
      }
    );
    return response.data.choices[0]?.message?.content || '';
  }

  if (process.env['DASHSCOPE_API_KEY']) {
    const response = await axios.post(
      `${process.env['DASHSCOPE_BASE_URL'] || 'https://dashscope.aliyuncs.com/compatible-mode/v1'}/chat/completions`,
      {
        model:      'qwen-max',
        messages:   [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt }],
        max_tokens: 1000,
      },
      {
        headers: { Authorization: `Bearer ${process.env['DASHSCOPE_API_KEY']}`, 'Content-Type': 'application/json' },
        timeout: 30000,
      }
    );
    return response.data.choices[0]?.message?.content || '';
  }

  if (process.env['DEEPSEEK_API_KEY']) {
    const response = await axios.post(
      'https://api.deepseek.com/chat/completions',
      {
        model:      'deepseek-chat',
        messages:   [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt }],
        max_tokens: 1000,
      },
      {
        headers: { Authorization: `Bearer ${process.env['DEEPSEEK_API_KEY']}`, 'Content-Type': 'application/json' },
        timeout: 30000,
      }
    );
    return response.data.choices[0]?.message?.content || '';
  }

  if (process.env['ANTHROPIC_API_KEY']) {
    const model  = CHAT_MODEL.startsWith('claude') ? CHAT_MODEL : 'claude-sonnet-4-6';
    const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });
    const res    = await client.messages.create({
      model, max_tokens: 1000, system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });
    return (res.content[0] as any)?.text || '';
  }

  throw new Error('No AI provider configured — set NVIDIA_API_KEY, GEMINI_API_KEY, DASHSCOPE_API_KEY, or DEEPSEEK_API_KEY');
}

async function handleMessage(messageText: string, fromName: string, topicId: number | null, roomContext?: string,
                              targetAgentId?: string | null, agentContext?: string | null, replyToMessageId?: number | null): Promise<void> {
  const hasKey = process.env['NVIDIA_API_KEY'] || process.env['GEMINI_API_KEY'] ||
                 process.env['DASHSCOPE_API_KEY'] || process.env['DEEPSEEK_API_KEY'] ||
                 process.env['ANTHROPIC_API_KEY'];
  if (!hasKey) {
    logger.warn('No AI API key configured — AI responses disabled');
    return;
  }

  // In the agent room without a direct target, pick the best agent to respond
  const isAgentRoom = topicId != null &&
    String(topicId) === String(process.env['AGENT_ROOM_TOPIC_ID']);
  const speakingAgent = targetAgentId ||
    (isAgentRoom ? pickSpeakingAgent(messageText) : null);

  logger.info({ from: fromName, text: messageText.substring(0, 80), speakingAgent },
    'AI handling Telegram message');

  // Store this incoming message in Redis context window (non-blocking)
  fireAndForget(storeRedisContext(topicId, fromName, messageText), { label: 'telegramAI' })

  try {
    const [context, history, recentActivity] = await Promise.all([
      buildContext(),
      getHistory(topicId ?? 0, 15).catch(() => []),
      getRedisContext(topicId),
    ]);

    const historySection = formatHistoryForPrompt(history);

    const recentSection = recentActivity.length > 0
      ? `\nRecent activity in this chat:\n${recentActivity.join('\n')}\n`
      : '';

    const agentSection = roomContext
      ? `\nAGENT ROOM CONTEXT:\n${roomContext}\n`
      : '';

    const directAddressSection = agentContext
      ? `\nADDITIONAL CONTEXT — You are being directly addressed:\n${agentContext}\n`
      : '';

    const AGENT_IDS    = ['nvidia','qwen_coder','qwen_coder_dash','llama_fast','gemini','qwen_max','qwen_turbo','deepseek','qwen_plus','opencode'];
    const mentionedIds = AGENT_IDS.filter(id => messageText.toLowerCase().includes(`@${id}`));
    let mentionSection = '';
    if (mentionedIds.length > 0) {
      const agents = await getAllAgents().catch(() => []);
      const lines  = mentionedIds.map(id => {
        const a = agents.find((x: any) => x.agent_id === id);
        if (!a) return `@${id}: not registered`;
        return a.status === 'working'
          ? `@${id}: working on ${a.repo_full_name?.split('/')[1]} — ${a.task_title}`
          : `@${id}: idle (${a.completed_tasks} done, ${a.failed_tasks} failed)`;
      }).join('\n');
      mentionSection = `\nMENTIONED AGENTS:\n${lines}\n`;
    }

    let personalityPrefix = '';
    if (speakingAgent) {
      try {
        const { getPersonalityPrompt } = require('./agentPersonality');
        const personality = getPersonalityPrompt(speakingAgent);
        if (personality) personalityPrefix = `${personality}\n\n`;
      } catch (err: any) {
        logger.warn({ err: err.message, speakingAgent }, 'Failed to load agent personality prompt — continuing without it');
      }
    }

    const prompt = `${personalityPrefix}${context}${historySection}${recentSection}${agentSection}${directAddressSection}${mentionSection}\nMessage from ${fromName}: ${messageText}`;

    const raw = await callChatAPI(prompt) ||
      '{"action":"answer","message":"Sorry, I had trouble understanding that."}';

    await trackChatCost(prompt.length, raw.length);

    let parsed: any;
    try {
      const cleaned = raw
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/```json?|```/g, '')
        .trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);
    } catch {
      // Strip think blocks so they don't leak into Telegram messages
      const visibleRaw = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      parsed = { action: 'answer', message: visibleRaw };
    }

    const responseText: string | null = parsed.action === 'answer' ? parsed.message : null;

    // Save to memory (non-blocking)
    fireAndForget(saveMessage(topicId ?? 0, fromName, messageText, responseText, speakingAgent as any), { label: 'telegramAI' })

    // Store Sentinel's response in the Redis context window too
    if (responseText) {
      fireAndForget(storeRedisContext(topicId, `Sentinel${speakingAgent ? `/${speakingAgent}` : ''}`, responseText), { label: 'telegramAI' })
    }

    // Route response through the speaking agent's bot when possible
    if (speakingAgent && parsed.action === 'answer' && parsed.message) {
      const { sendAsAgent } = require('./agentBots');
      await sendAsAgent(speakingAgent, parsed.message, replyToMessageId).catch(async () => {
        await executeAction(parsed, topicId);
      });
    } else {
      await executeAction(parsed, topicId);
    }

  } catch (err: any) {
    logger.error({ err: err.stack ?? err.message }, 'AI response failed');
    await safeFire(sendTelegramMessage(
      'Having trouble processing that. Try a slash command instead.',
      null, topicId
    ), { label: 'telegramAI' })
  }
}

const REPO_REQUIRED_ACTIONS = ['execute_tasks', 'trigger_audit', 'stop_repo', 'assign_repo', 'create_task'];

async function executeAction(action: any, topicId: number | null): Promise<void> {
  const resolved        = action.repo ? resolveRepoName(action.repo) : null;
  const repoName        = resolved?.repoName || null;
  const repoFullNameVal = resolved?.repoFullName || null;

  // If the AI named a repo that doesn't match anything real, refuse instead of
  // guessing a fake full name
  if (action.repo && !resolved && REPO_REQUIRED_ACTIONS.includes(action.action)) {
    const { REPO_LIST } = require('./portfolioAnalytics');
    const known = [...REPO_LIST.map((r: any) => r.repoName), 'project-sentinel'].join(', ');
    await safeFire(sendTelegramMessage(
      `I don't recognize repo "${action.repo}". Known repos: ${known}`,
      null, topicId
    ), { label: 'telegramAI' })
    return;
  }

  switch (action.action) {
    case 'execute_tasks':
      if (!repoFullNameVal) break;
      await safeFire(sendTelegramMessage(
        `Starting task execution for ${repoName}...`, null, topicId
      ), { label: 'telegramAI' })
      executeApprovedTasks(repoFullNameVal, repoName, topicId)
        .catch((err: any) => logger.error({ err: err.stack ?? err.message }, 'AI execute failed'));
      break;

    case 'trigger_audit':
      if (!repoFullNameVal) break;
      await safeFire(sendTelegramMessage(
        `Triggering audit for ${repoName}...`, null, topicId
      ), { label: 'telegramAI' })
      const branchName = await getDefaultBranch(repoFullNameVal).catch(() => 'main');
      triggerAudit({
        repoFullName: repoFullNameVal, repoName,
        projectName: repoName, commitSha: `manual-${Date.now()}`,
        commitMessage: '[manual-audit]', branchName,
        authorName: 'Human', authorEmail: '', topicId,
      }).catch((err: any) => logger.error({ err: err.stack ?? err.message }, 'AI audit failed'));
      break;

    case 'stop_repo':
      if (!repoFullNameVal) break;
      await stopAllTasksForRepo(repoFullNameVal);
      await safeFire(sendTelegramMessage(
        `All tasks and audits stopped for ${repoName}.`, null, topicId
      ), { label: 'telegramAI' })
      break;

    case 'send_report':
      await sendDailyReport();
      break;

    case 'show_costs': {
      const { getCostReport } = require('./costTracker');
      const report = await getCostReport();
      await safeFire(sendTelegramMessage(report.formatted, null, topicId), { label: 'telegramAI' })
      break;
    }

    case 'approve_sprint':
      fireAndForget(approveSprint(topicId), { label: 'telegramAI' })
      break;

    case 'sprint_status':
      fireAndForget(getSprintStatus(topicId), { label: 'telegramAI' })
      break;

    case 'velocity_report': {
      const report = await getVelocityReport().catch(() => 'Velocity data unavailable.');
      await safeFire(sendTelegramMessage(report, null, topicId), { label: 'telegramAI' })
      break;
    }

    case 'show_agents': {
      const summary = await getAgentRoomSummary();
      await safeFire(sendTelegramMessage(summary, null, topicId), { label: 'telegramAI' })
      break;
    }

    case 'agent_status': {
      const agents = await getAllAgents();
      const target = agents.find((a: any) => a.agent_id === action.agent);
      if (!target) {
        await safeFire(sendTelegramMessage(
          `Unknown agent: ${action.agent}`, null, topicId
        ), { label: 'telegramAI' })
        break;
      }
      const status = target.status === 'working'
        ? `working on ${target.repo_full_name?.split('/')[1]} — ${target.task_title}`
        : `idle (${target.completed_tasks} done, ${target.failed_tasks} failed)`;
      await safeFire(sendTelegramMessage(
        `${action.agent}: ${status}`, null, topicId
      ), { label: 'telegramAI' })
      break;
    }

    case 'assign_repo': {
      if (!repoFullNameVal || !action.agent) break;
      const project = await findNotionProject(repoName).catch(() => null);
      if (!project) {
        await safeFire(sendTelegramMessage(
          `No Notion project found for ${repoName}.`, null, topicId
        ), { label: 'telegramAI' })
        break;
      }
      await updateBuilderAgent(project.pageId, action.agent);
      await safeFire(sendTelegramMessage(
        `${repoName} assigned to ${action.agent} in Notion.`, null, topicId
      ), { label: 'telegramAI' })
      break;
    }

    case 'stop_agent': {
      if (!action.agent) break;
      const agents = await getAllAgents();
      const target = agents.find((a: any) => a.agent_id === action.agent);
      if (target?.repo_full_name) {
        await stopAllTasksForRepo(target.repo_full_name);
      }
      await setAgentIdle(action.agent, false);
      await safeFire(sendTelegramMessage(
        `${action.agent} stopped and marked idle.`, null, topicId
      ), { label: 'telegramAI' })
      break;
    }

    case 'create_task': {
      if (!action.repo || !action.title) break;
      const taskRepoName = repoName;
      const taskRepoFull = repoFullNameVal;
      try {
        const { createAuditTask, createAuditCycle, getActiveCycleForRepo } = require('./auditDb');

        let cycle = await getActiveCycleForRepo(taskRepoFull).catch(() => null);
        if (!cycle) {
          cycle = await createAuditCycle({
            repoFullName: taskRepoFull,
            commitSha:    `nl-task-${Date.now()}`,
            projectName:  taskRepoName,
          }).catch(() => null);
        }

        if (cycle) {
          await createAuditTask({
            auditCycleId:      cycle.id,
            repoFullName:      taskRepoFull,
            taskNumber:        1,
            title:             action.title,
            description:       action.description || action.title,
            priority:          action.priority || 'medium',
            complexity:        'medium',
            affectedFiles:     [],
            acceptanceCriteria: `Complete: ${action.title}`,
            safeToAutoExecute: false,
            batchNumber:       1,
          });

          await safeFire(sendTelegramMessage([
            `✅ Task created for ${taskRepoName}`,
            ``,
            `Title: ${action.title}`,
            `Priority: ${action.priority || 'medium'}`,
            `Status: queued (needs approval)`,
            ``,
            `Use /sentinel force-execute ${taskRepoName} to run it now.`,
          ].join('\n'), null, topicId), { label: 'telegramAI' })
        }
      } catch (err: any) {
        logger.error({ err: err.stack ?? err.message }, 'create_task action failed');
        await safeFire(sendTelegramMessage(
          `Failed to create task: ${err.message}`, null, topicId
        ), { label: 'telegramAI' })
      }
      break;
    }

    case 'answer':
    default:
      if (action.message) {
        await safeFire(sendTelegramMessage(action.message, null, topicId), { label: 'telegramAI' })
      }
      break;
  }
}

export = { handleMessage, pickSpeakingAgent, __test__executeAction: executeAction };

