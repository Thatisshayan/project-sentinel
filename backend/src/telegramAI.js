const Anthropic = require('@anthropic-ai/sdk');
const axios     = require('axios');
const logger    = require('./logger');
const { getPortfolioSummary }  = require('./portfolioAnalytics');
const { getOpenPatterns,
        getDailyCost,
        getMonthlyCost }       = require('./portfolioDb');
const { sendTelegramMessage }  = require('./telegramClient');
const { trackChatCost }        = require('./costTracker');
const { sendDailyReport }      = require('./dailyReport');
const { updateDashboard }      = require('./notionDashboard');
const {
  executeApprovedTasks,
  triggerAudit,
} = require('./auditOrchestrator');
const { stopAllTasksForRepo }  = require('./auditDb');
const { approveSprint,
        getSprintStatus }      = require('./sprintOrchestrator');
const { getVelocityReport }    = require('./velocityTracker');
const { getAgentRoomSummary }  = require('./agentRoom');
const { setAgentIdle,
        getAllAgents }          = require('./agentDb');
const { findNotionProject,
        updateBuilderAgent }   = require('./notionClient');

const CHAT_MODEL = process.env.CHAT_MODEL || 'nvidia/llama-3.1-nemotron-70b-instruct';

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
- { "action": "answer", "message": "<your response>" }

NATURAL LANGUAGE TRIGGERS:
- "assign <repo> to <agent>"   → action: assign_repo
- "swap <repo> to <agent>"     → action: assign_repo
- "what is <agent> doing?"     → action: agent_status
- "what is <agent> working on?"→ action: agent_status
- "stop <agent>"               → action: stop_agent

AGENT IDs: nvidia, qwen_coder, qwen_coder_dash, llama_fast, gemini, qwen_max, qwen_plus, qwen_turbo, deepseek, opencode

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

async function buildContext() {
  try {
    const [summary, patterns, dailyCost, monthlyCost] = await Promise.all([
      getPortfolioSummary(),
      getOpenPatterns(),
      getDailyCost(),
      getMonthlyCost(),
    ]);

    const repoStates = summary.metrics.map(m =>
      `${m.repo_name}: health=${m.health_score}/10 status=${m.build_status} priority=${m.priority} tasks_queued=${m.tasks_queued}`
    ).join('\n');

    return `CURRENT PORTFOLIO STATE:
Health average: ${summary.avgHealth}/10
Healthy repos: ${summary.healthy.length}
Broken repos: ${summary.broken.length} — ${summary.broken.map(m => m.repo_name).join(', ')}

REPO DETAILS:
${repoStates}

PATTERNS DETECTED: ${patterns.length}
${patterns.slice(0, 3).map(p => `- ${p.description} (${(p.affected_repos || []).length} repos)`).join('\n')}

API COSTS: $${dailyCost.toFixed(2)} today, $${monthlyCost.toFixed(2)} this month`;
  } catch (err) {
    return 'Portfolio context unavailable — database may be initialising.';
  }
}

// Calls whichever AI provider is available.
// Primary: Anthropic SDK (when ANTHROPIC_API_KEY is set).
// Fallback: NVIDIA NIM via OpenAI-compatible endpoint (when NVIDIA_API_KEY is set).
async function callChatAPI(prompt) {
  if (process.env.ANTHROPIC_API_KEY) {
    const model = CHAT_MODEL.startsWith('claude') ? CHAT_MODEL : 'claude-sonnet-4-6';
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model,
      max_tokens: 500,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: prompt }],
    });
    return response.content[0]?.text || '';
  }

  if (process.env.NVIDIA_API_KEY) {
    const response = await axios.post(
      'https://integrate.api.nvidia.com/v1/chat/completions',
      {
        model:       CHAT_MODEL,
        messages:    [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: prompt },
        ],
        max_tokens:  500,
        temperature: 0.3,
      },
      {
        headers: {
          Authorization:  `Bearer ${process.env.NVIDIA_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );
    return response.data.choices[0]?.message?.content || '';
  }

  throw new Error('No AI provider configured (ANTHROPIC_API_KEY or NVIDIA_API_KEY required)');
}

async function handleMessage(messageText, fromName, topicId, roomContext) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.NVIDIA_API_KEY) {
    logger.warn('No AI API key configured — AI responses disabled');
    return;
  }

  logger.info({ from: fromName, text: messageText.substring(0, 80) },
    'AI handling Telegram message');

  try {
    const context = await buildContext();
    const agentSection = roomContext
      ? `\nAGENT ROOM CONTEXT:\n${roomContext}\n`
      : '';
    const prompt  = `${context}${agentSection}\nMessage from ${fromName}: ${messageText}`;

    const raw = await callChatAPI(prompt) ||
      '{"action":"answer","message":"Sorry, I had trouble understanding that."}';

    await trackChatCost(prompt.length, raw.length);

    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/```json?|```/g, '').trim());
    } catch (e) {
      parsed = { action: 'answer', message: raw };
    }

    await executeAction(parsed, topicId);

  } catch (err) {
    logger.error({ err: err.message }, 'AI response failed');
    await sendTelegramMessage(
      'Having trouble processing that. Try a slash command instead.',
      null, topicId
    ).catch(() => {});
  }
}

async function executeAction(action, topicId) {
  const repoFullName = action.repo ? `Thatisshayan/${action.repo}` : null;

  switch (action.action) {
    case 'execute_tasks':
      if (!repoFullName) break;
      await sendTelegramMessage(
        `Starting task execution for ${action.repo}...`, null, topicId
      ).catch(() => {});
      executeApprovedTasks(repoFullName, action.repo, topicId)
        .catch(err => logger.error({ err: err.message }, 'AI execute failed'));
      break;

    case 'trigger_audit':
      if (!repoFullName) break;
      await sendTelegramMessage(
        `Triggering audit for ${action.repo}...`, null, topicId
      ).catch(() => {});
      triggerAudit({
        repoFullName, repoName: action.repo,
        projectName: action.repo, commitSha: `manual-${Date.now()}`,
        commitMessage: '[manual-audit]', branchName: 'main',
        authorName: 'Human', authorEmail: '', topicId,
      }).catch(err => logger.error({ err: err.message }, 'AI audit failed'));
      break;

    case 'stop_repo':
      if (!repoFullName) break;
      await stopAllTasksForRepo(repoFullName);
      await sendTelegramMessage(
        `All tasks and audits stopped for ${action.repo}.`, null, topicId
      ).catch(() => {});
      break;

    case 'send_report':
      await sendDailyReport();
      break;

    case 'show_costs': {
      const { getCostReport } = require('./costTracker');
      const report = await getCostReport();
      await sendTelegramMessage(report.formatted, null, topicId).catch(() => {});
      break;
    }

    case 'approve_sprint':
      approveSprint(topicId).catch(() => {});
      break;

    case 'sprint_status':
      getSprintStatus(topicId).catch(() => {});
      break;

    case 'velocity_report': {
      const report = await getVelocityReport().catch(() => 'Velocity data unavailable.');
      await sendTelegramMessage(report, null, topicId).catch(() => {});
      break;
    }

    case 'show_agents': {
      const summary = await getAgentRoomSummary();
      await sendTelegramMessage(summary, null, topicId).catch(() => {});
      break;
    }

    case 'agent_status': {
      const agents = await getAllAgents();
      const target = agents.find(a => a.agent_id === action.agent);
      if (!target) {
        await sendTelegramMessage(
          `Unknown agent: ${action.agent}`, null, topicId
        ).catch(() => {});
        break;
      }
      const status = target.status === 'working'
        ? `working on ${target.repo_full_name?.split('/')[1]} — ${target.task_title}`
        : `idle (${target.completed_tasks} done, ${target.failed_tasks} failed)`;
      await sendTelegramMessage(
        `${action.agent}: ${status}`, null, topicId
      ).catch(() => {});
      break;
    }

    case 'assign_repo': {
      if (!repoFullName || !action.agent) break;
      const project = await findNotionProject(action.repo).catch(() => null);
      if (!project) {
        await sendTelegramMessage(
          `No Notion project found for ${action.repo}.`, null, topicId
        ).catch(() => {});
        break;
      }
      await updateBuilderAgent(project.pageId, action.agent);
      await sendTelegramMessage(
        `${action.repo} assigned to ${action.agent} in Notion.`, null, topicId
      ).catch(() => {});
      break;
    }

    case 'stop_agent': {
      if (!action.agent) break;
      const agents = await getAllAgents();
      const target = agents.find(a => a.agent_id === action.agent);
      if (target?.repo_full_name) {
        await stopAllTasksForRepo(target.repo_full_name);
      }
      await setAgentIdle(action.agent, false);
      await sendTelegramMessage(
        `${action.agent} stopped and marked idle.`, null, topicId
      ).catch(() => {});
      break;
    }

    case 'answer':
    default:
      if (action.message) {
        await sendTelegramMessage(action.message, null, topicId).catch(() => {});
      }
      break;
  }
}

module.exports = { handleMessage };
