const axios  = require('axios');
const logger = require('./logger');
const { query }                          = require('./dbClient');
const { getAllLatestMetrics }            = require('./portfolioDb');
const { getCapacityStatus, selectBuilder } = require('./capacityManager');
const { getVelocityTrend, createSprint,
        createSprintTask }              = require('./sprintDb');
const { getWeekStart }                  = require('./velocityTracker');
const { sendTelegramMessage }           = require('./telegramClient');

const SPRINT_MAX_TASKS = () => parseInt(process.env.SPRINT_MAX_TASKS || '15');
const SPRINT_MODEL     = process.env.SPRINT_MODEL; // optional override

// ── Free AI provider chain (no Anthropic) ────────────────────────────────────
// Priority: NVIDIA NIM → Gemini → DashScope Qwen → DeepSeek

async function callFreeAI(prompt) {
  if (process.env.NVIDIA_API_KEY) {
    const model = SPRINT_MODEL || 'nvidia/llama-3.1-nemotron-70b-instruct';
    logger.info({ model }, 'Sprint planner using NVIDIA NIM');
    const res = await axios.post(
      'https://integrate.api.nvidia.com/v1/chat/completions',
      { model, messages: [{ role: 'user', content: prompt }], max_tokens: 2000, temperature: 0.1 },
      { headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 90000 }
    );
    return res.data.choices[0]?.message?.content || '';
  }

  if (process.env.GEMINI_API_KEY) {
    const model = SPRINT_MODEL || 'gemini-2.0-flash';
    logger.info({ model }, 'Sprint planner using Gemini');
    const res = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      { model, messages: [{ role: 'user', content: prompt }], max_tokens: 2000 },
      { headers: { Authorization: `Bearer ${process.env.GEMINI_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 90000 }
    );
    return res.data.choices[0]?.message?.content || '';
  }

  if (process.env.DASHSCOPE_API_KEY) {
    const model = SPRINT_MODEL || 'qwen-max';
    logger.info({ model }, 'Sprint planner using DashScope Qwen');
    const res = await axios.post(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      { model, messages: [{ role: 'user', content: prompt }], max_tokens: 2000 },
      { headers: { Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 90000 }
    );
    return res.data.choices[0]?.message?.content || '';
  }

  if (process.env.DEEPSEEK_API_KEY) {
    const model = SPRINT_MODEL || 'deepseek-chat';
    logger.info({ model }, 'Sprint planner using DeepSeek');
    const res = await axios.post(
      'https://api.deepseek.com/chat/completions',
      { model, messages: [{ role: 'user', content: prompt }], max_tokens: 2000 },
      { headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 90000 }
    );
    return res.data.choices[0]?.message?.content || '';
  }

  throw new Error('No free AI provider configured. Set NVIDIA_API_KEY, GEMINI_API_KEY, DASHSCOPE_API_KEY, or DEEPSEEK_API_KEY.');
}

// ── Week date helpers ─────────────────────────────────────────────────────────

function getWeekDates() {
  const now    = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() + ((1 + 7 - now.getDay()) % 7 || 7));
  monday.setHours(0, 0, 0, 0);
  const saturday = new Date(monday);
  saturday.setDate(monday.getDate() + 5);
  return {
    weekStart: monday.toISOString().split('T')[0],
    weekEnd:   saturday.toISOString().split('T')[0],
  };
}

// ── Context builder ───────────────────────────────────────────────────────────

async function buildPlannerContext(metrics, capacity, velocityTrend) {
  // audit_tasks.estimated_complexity is the correct column name
  const queuedTasks = await query(`
    SELECT id, repo_full_name, title, description, priority, estimated_complexity
    FROM audit_tasks
    WHERE status = 'queued'
      AND safe_to_auto_execute = true
    ORDER BY
      CASE priority
        WHEN 'critical' THEN 1
        WHEN 'high'     THEN 2
        WHEN 'medium'   THEN 3
        ELSE 4
      END,
      created_at ASC
    LIMIT 50
  `);

  const repoHealthMap = Object.fromEntries(
    metrics.map(m => [m.repo_name, {
      health:   m.health_score,
      status:   m.build_status,
      priority: m.priority,
      queued:   m.tasks_queued,
    }])
  );

  const taskList = queuedTasks.rows.map(t =>
    `- [${t.priority}] ${(t.repo_full_name || '').split('/')[1]}: ${t.title} (complexity: ${t.estimated_complexity})`
  ).join('\n');

  const velocityStr = velocityTrend.length > 0
    ? `Last week: ${velocityTrend[velocityTrend.length - 1].tasks_completed} tasks completed`
    : 'First sprint — no velocity data yet';

  return `PORTFOLIO STATE:
${JSON.stringify(repoHealthMap, null, 2)}

AVAILABLE TASKS (${queuedTasks.rows.length} total):
${taskList || 'No queued tasks'}

CAPACITY:
Budget used: ${capacity.usagePercent}% ($${capacity.monthlySpend.toFixed(2)} of $${capacity.monthlyBudget})
Recommended builder: ${capacity.recommendedBuilder}
${velocityStr}`;
}

// ── Main proposal generator ───────────────────────────────────────────────────

async function generateSprintProposal() {
  logger.info('Generating weekly sprint proposal');

  const [metrics, capacity, velocityTrend] = await Promise.all([
    getAllLatestMetrics(),
    getCapacityStatus(),
    getVelocityTrend(2),
  ]);

  const context              = await buildPlannerContext(metrics, capacity, velocityTrend);
  const { weekStart, weekEnd } = getWeekDates();
  const maxTasks             = SPRINT_MAX_TASKS();

  const prompt = `You are Project Sentinel's sprint planner for a 12-repo portfolio.

${context}

Select up to ${maxTasks} tasks for next week's sprint (${weekStart} to ${weekEnd}).

Rules:
1. Prioritize critical and high priority tasks first
2. Prioritize repos with low health scores
3. Maximum 3 tasks per repo to spread work evenly
4. Skip high-complexity tasks unless the repo is critical priority
5. Consider the budget — if budget > 75%, prefer low-complexity tasks only
6. Balance the sprint — not all one repo

Respond with ONLY valid JSON:
{
  "summary": "2-sentence plain English sprint plan summary",
  "weekStart": "${weekStart}",
  "weekEnd": "${weekEnd}",
  "totalTasks": <number>,
  "estimatedCost": <number in USD>,
  "tasks": [
    {
      "repoName": "<repo name>",
      "repoFullName": "Thatisshayan/<repo>",
      "taskTitle": "<title>",
      "taskDescription": "<description>",
      "priority": "critical|high|medium|low",
      "complexity": "low|medium|high",
      "builderAgent": "nvidia|gemini|qwen_max|deepseek|claude",
      "estimatedCost": <number>,
      "reason": "<why this task this week>"
    }
  ]
}`;

  const raw = await callFreeAI(prompt);

  let proposal;
  try {
    proposal = JSON.parse(raw.replace(/```json?|```/g, '').trim());
  } catch (err) {
    throw new Error(`Sprint proposal JSON parse failed: ${err.message}\nRaw: ${raw.slice(0, 200)}`);
  }

  if (!Array.isArray(proposal.tasks) || proposal.tasks.length === 0) {
    throw new Error('Sprint proposal returned no tasks');
  }

  const avgHealth = metrics.length > 0
    ? metrics.reduce((s, m) => s + parseFloat(m.health_score || 5), 0) / metrics.length
    : 5.0;

  const sprint = await createSprint({
    weekStart:       proposal.weekStart || weekStart,
    weekEnd:         proposal.weekEnd   || weekEnd,
    totalTasks:      proposal.tasks.length,
    estimatedCost:   proposal.estimatedCost || 0,
    healthStart:     parseFloat(avgHealth.toFixed(1)),
    proposalSummary: proposal.summary,
  });

  for (let i = 0; i < proposal.tasks.length; i++) {
    const task = proposal.tasks[i];
    await createSprintTask({
      sprintId:        sprint.id,
      auditTaskId:     null,
      repoFullName:    task.repoFullName,
      repoName:        task.repoName,
      taskTitle:       task.taskTitle,
      taskDescription: task.taskDescription || task.reason || '',
      priority:        task.priority,
      complexity:      task.complexity,
      builderAgent:    selectBuilder(task.repoName, capacity, task.builderAgent),
      estimatedCost:   task.estimatedCost || 0,
      executionOrder:  i + 1,
    });
  }

  logger.info({ sprintId: sprint.id, tasks: proposal.tasks.length }, 'Sprint proposal saved');

  // Send Telegram approval request
  const PRIORITY_EMOJI = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
  const reposInSprint  = [...new Set(proposal.tasks.map(t => t.repoName))];
  const taskLines      = proposal.tasks.map((t, i) =>
    `${i + 1}. ${PRIORITY_EMOJI[t.priority] || '⚪'} ${t.repoName}: ${t.taskTitle}`
  ).join('\n');

  await sendTelegramMessage([
    `Project Sentinel — Sprint Proposal 📋`,
    `Week of ${weekStart}`,
    ``,
    proposal.summary,
    ``,
    `${proposal.tasks.length} tasks across ${reposInSprint.length} repos:`,
    taskLines,
    ``,
    `Estimated cost: $${(proposal.estimatedCost || 0).toFixed(2)}`,
    `Budget remaining: $${capacity.remaining.toFixed(2)} (${100 - capacity.usagePercent}% left)`,
    ``,
    `/sentinel approve-sprint  — start executing Monday`,
    `/sentinel skip-sprint     — skip this week`,
    `/sentinel sprint-status   — view task list`,
  ].join('\n'), null, null);

  return { sprint, proposal };
}

module.exports = { generateSprintProposal };
