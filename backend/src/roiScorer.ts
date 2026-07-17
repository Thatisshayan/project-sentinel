import logger from './logger';
import { getLatestMetrics, upsertTaskROI } from './businessDb';
import { getAllLatestMetrics } from './portfolioDb';

const PRIORITY_BONUS: Record<string, number> = { critical: 4, high: 3, medium: 1, low: 0 };

const BUSINESS_PRIORITY_BONUS: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };

const CATEGORY_BONUS: Record<string, number> = {
  security:          3,
  performance:       2,
  'error-handling':  2,
  dependencies:      1,
  testing:           1,
  documentation:     0,
  'code-quality':    0,
  'dead-code':       0,
};

async function scoreTask(task: any, repoName: string, repoPriority: string): Promise<number> {
  const baseScore     = 5.0;
  let   priorityBonus = PRIORITY_BONUS[task.priority] || 0;
  const healthBonus   = 0;
  let   revenueBonus  = 0;
  const categoryBonus = CATEGORY_BONUS[task.category] || 0;
  const reasons: string[]       = [];

  const bizBonus = BUSINESS_PRIORITY_BONUS[repoPriority] || 0;
  priorityBonus += bizBonus;
  if (bizBonus > 0) reasons.push(`${repoPriority} business priority (+${bizBonus})`);

  if (categoryBonus > 0) {
    reasons.push(`${task.category} category (+${categoryBonus})`);
    priorityBonus += categoryBonus;
  }

  const metrics = await getLatestMetrics(repoName).catch(() => []);
  const revenue = metrics.find((m: any) => m.metric_name === 'revenue_today');
  if (revenue && parseFloat(revenue.metric_value) > 0) {
    revenueBonus = 2;
    reasons.push(`active revenue ($${parseFloat(revenue.metric_value).toFixed(0)}/day) (+2)`);
  }

  const finalScore = Math.min(10, baseScore + priorityBonus + healthBonus + revenueBonus);

  await upsertTaskROI({
    auditTaskId:  task.id,
    repoName,
    baseScore,
    priorityBonus,
    healthBonus,
    revenueBonus,
    finalScore,
    scoringReason: reasons.join(', ') || 'standard scoring',
  }).catch(() => {});

  return finalScore;
}

async function scoreAllQueuedTasks(): Promise<void> {
  const { query } = require('./dbClient') as { query: (...args: any[]) => Promise<any> };

  const tasks = await query(`
    SELECT at.*, ac.repo_full_name
    FROM audit_tasks at
    JOIN audit_cycles ac ON ac.id = at.audit_cycle_id
    WHERE at.status = 'queued'
      AND NOT EXISTS (
        SELECT 1 FROM task_roi_scores WHERE audit_task_id = at.id
      )
    LIMIT 100
  `);

  const allMetrics = await getAllLatestMetrics().catch(() => []);
  const priorityMap: Record<string, string> = Object.fromEntries(
    allMetrics.map((m: any) => [m.repo_name, m.priority])
  );

  for (const task of tasks.rows) {
    const repoName = task.repo_full_name?.split('/')[1];
    const priority = priorityMap[repoName] || 'medium';
    await scoreTask(task, repoName, priority).catch(() => {});
  }

  logger.info({ count: tasks.rows.length }, 'ROI scoring complete');
}

export = { scoreTask, scoreAllQueuedTasks };
