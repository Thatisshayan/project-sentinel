import { getMonthlyCost } from './portfolioDb';
import logger from './logger';
import type { CapacityStatus } from './types/capacityStatus';

const MONTHLY_BUDGET         = (): number => parseFloat(process.env['SPRINT_MONTHLY_BUDGET'] || '30');
const CLAUDE_COST_PER_AUDIT  = 0.08;
const CLAUDE_COST_PER_TASK   = 0.05;

async function getCapacityStatus(): Promise<CapacityStatus> {
  const monthlySpend  = await getMonthlyCost();
  const budget        = MONTHLY_BUDGET();
  const remaining     = budget - monthlySpend;
  const usagePercent  = budget > 0 ? (monthlySpend / budget) * 100 : 0;

  let recommendedBuilder = 'claude';
  let reason             = 'Budget healthy';

  if (usagePercent >= 90) {
    recommendedBuilder = 'nvidia';
    reason = 'Budget at 90%+ — routing to free builder';
  } else if (usagePercent >= 75) {
    recommendedBuilder = 'nvidia';
    reason = 'Budget at 75%+ — conserving Claude quota';
  }

  return {
    monthlyBudget:      budget,
    monthlySpend,
    remaining,
    usagePercent:       Math.round(usagePercent),
    recommendedBuilder,
    reason,
    canAffordAudit:     remaining > CLAUDE_COST_PER_AUDIT,
    canAffordTask:      remaining > CLAUDE_COST_PER_TASK,
    estimatedTasksLeft: Math.floor(remaining / CLAUDE_COST_PER_TASK),
  };
}

function estimateTaskCost(builderAgent: string, count: number = 1): number {
  const costMap: Record<string, number> = {
    claude:          CLAUDE_COST_PER_TASK,
    nvidia:          0.0,
    qwen_coder:      0.0,
    llama_fast:      0.0,
    gemini:          0.001,
    qwen_max:        0.002,
    qwen_plus:       0.001,
    qwen_coder_dash: 0.001,
    qwen_turbo:      0.0005,
    deepseek:        0.001,
    opencode:        0.01,
  };
  return (costMap[builderAgent] || CLAUDE_COST_PER_TASK) * count;
}

function selectBuilder(repoName: string, capacity: CapacityStatus, notionBuilder: string): string {
  if (capacity.usagePercent >= 75) {
    // Route to first available free builder
    if (process.env['NVIDIA_API_KEY'])     { logger.info({ repoName, reason: capacity.reason }, 'Budget routing to NVIDIA'); return 'nvidia'; }
    if (process.env['GEMINI_API_KEY'])     { logger.info({ repoName, reason: capacity.reason }, 'Budget routing to Gemini'); return 'gemini'; }
    if (process.env['DASHSCOPE_API_KEY'])  { logger.info({ repoName, reason: capacity.reason }, 'Budget routing to Qwen'); return 'qwen_max'; }
    if (process.env['DEEPSEEK_API_KEY'])   { logger.info({ repoName, reason: capacity.reason }, 'Budget routing to DeepSeek'); return 'deepseek'; }
    logger.warn({ repoName }, 'Budget at 75%+ but no free builder keys set — using claude');
  }
  return notionBuilder || 'claude';
}

export = { getCapacityStatus, estimateTaskCost, selectBuilder };
