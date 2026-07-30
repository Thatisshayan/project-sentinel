import { safeFire, fireAndForget } from './utils/safeFire';
import logger from './logger';
import { callAnyProvider } from './ai/client';
import { getGithubOrg } from './repoResolver';
import { validateSprintOutput } from './aiOutputValidator';
import { query } from './dbClient';
import { getAllLatestMetrics } from './portfolioDb';
import { getCapacityStatus, selectBuilder } from './capacityManager';
import { getVelocityTrend, createSprint, createSprintTask } from './sprintDb';
import { getWeekStart } from './velocityTracker';
import { sendTelegramMessage } from './telegramClient';

const SPRINT_MAX_TASKS = (): number => parseInt(process.env['SPRINT_MAX_TASKS'] || '15');
const SPRINT_MODEL     = process.env['SPRINT_MODEL'];

async function callFreeAI(prompt: string): Promise<string> {
  return callAnyProvider({
    userPrompt:  prompt,
    maxTokens:   2000,
    temperature: 0.1,
    timeoutMs:   90000,
    models: SPRINT_MODEL
      ? { nvidia: SPRINT_MODEL, gemini: SPRINT_MODEL, dashscope: SPRINT_MODEL, deepseek: SPRINT_MODEL }
      : {},
  });
}

function getWeekDates(): { weekStart: string; weekEnd: string } {
  const now    = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() + ((1 + 7 - now.getDay()) % 7 || 7));
  monday.setHours(0, 0, 0, 0);
  const saturday = new Date(monday);
  saturday.setDate(monday.getDate() + 5);
  return {
    weekStart: monday.toISOString().split('T')[0] || '',
    weekEnd:   saturday.toISOString().split('T')[0] || '',
  };
}

async function buildPlannerContext(metrics: any[], capacity: any, velocityTrend: any[]): Promise<string> {
  const queuedTasks = await query(`
    SELECT id, repo_full_name, title, description, priority, complexity AS estimated_complexity
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

  const repoHealthMap: Record<string, any> = Object.fromEntries(
    metrics.map((m: any) => [m.repo_name, {
      health:   m.health_score,
      status:   m.build_status,
      priority: m.priority,
      queued:   m.tasks_queued,
    }])
  );

  const taskList = queuedTasks.rows.map((t: any) =>
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

async function generateSprintProposal(): Promise<{ sprint: any; proposal: any }> {
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
      "repoFullName": "${getGithubOrg()}/<repo>",
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

  let proposal: any;
  try {
    const cleaned = raw
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/```json?|```/g, '')
      .trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    proposal = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);
  } catch (err: any) {
    throw new Error(`Sprint proposal JSON parse failed: ${err.message}\nRaw: ${raw.slice(0, 200)}`);
  }

  if (!Array.isArray(proposal.tasks) || proposal.tasks.length === 0) {
    throw new Error('Sprint proposal returned no tasks');
  }
  validateSprintOutput(proposal);

  const avgHealth = metrics.length > 0
    ? metrics.reduce((s: number, m: any) => s + parseFloat(m.health_score || 5), 0) / metrics.length
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

  const PRIORITY_EMOJI: Record<string, string> = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
  const reposInSprint  = [...new Set(proposal.tasks.map((t: any) => t.repoName))];
  const taskLines      = proposal.tasks.map((t: any, i: number) =>
    `${i + 1}. ${PRIORITY_EMOJI[t.priority] || '⚪'} ${t.repoName}: ${t.taskTitle}`
  ).join('\n');

  const sprintLines = [
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
  ];

  try {
    const { loadSettings } = require('./settingsLoader') as { loadSettings: () => Promise<any> };
    const settings = await loadSettings();
    if (settings.auto_approve_tasks) {
      sprintLines.push(`\n⏳ Auto-approves in 2h unless you skip below.`);
    }
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Could not load auto-approve setting');
  }

  const sprintText = sprintLines.filter(Boolean).join('\n');

  try {
    const { sendMenu } = require('./telegramMenus') as { sendMenu: (...args: any[]) => Promise<any> };
    const chatId = process.env['TELEGRAM_CHAT_ID'];
    await sendMenu(chatId, null, sprintText, [
      [
        { text: '✅ Approve Sprint',  callback_data: 'approve:sprint'      },
        { text: '⏭ Skip Sprint',     callback_data: 'approve:skip-sprint'  },
      ],
      [
        { text: '📋 View Tasks',     callback_data: 'menu:sprint'          },
      ],
    ]);
  } catch {
    await safeFire(sendTelegramMessage(sprintText, null, null), { label: 'sprintPlanner' })
  }

  try {
    const { scheduleAutoApprove } = require('./autoApprover') as { scheduleAutoApprove: (sprintId: any, topicId: any) => Promise<void> };
    await scheduleAutoApprove(sprint.id, null);
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Auto-approve scheduling failed — non-blocking');
  }

  return { sprint, proposal };
}

export = { generateSprintProposal };
