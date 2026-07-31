import { logApiCost, getCostByRepo, getDailyCost, getMonthlyCost } from './portfolioDb';
import logger from './logger';
import type { RepoCostRow } from './types/portfolioRow';

interface CostReport {
  daily: number;
  monthly: number;
  byRepo: RepoCostRow[];
  formatted: string;
}

const COSTS_PER_1K: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-5': { input: 0.003,   output: 0.015   },
  'claude-opus-4-5':   { input: 0.015,   output: 0.075   },
  'claude-sonnet-4-6': { input: 0.003,   output: 0.015   },
  'gemini-2.5-pro':    { input: 0.00125, output: 0.005   },
  'gemini-2.0-flash':  { input: 0.0001,  output: 0.0004  },
  'deepseek-coder':    { input: 0.00014, output: 0.00028 },
  'qwen-max':          { input: 0.0024,  output: 0.0096  },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = COSTS_PER_1K[model] || { input: 0.003, output: 0.015 };
  return (inputTokens  / 1000 * rates.input) +
         (outputTokens / 1000 * rates.output);
}

function estimateTokens(textOrLength: string | number): number {
  const chars = typeof textOrLength === 'number'
    ? textOrLength
    : (textOrLength || '').length;
  return Math.ceil((chars || 0) / 4);
}

async function trackAuditCost(repoFullName: string, promptLength: string | number, outputLength: string | number): Promise<number> {
  const model        = 'claude-sonnet-4-5';
  const inputTokens  = estimateTokens(promptLength);
  const outputTokens = estimateTokens(outputLength);
  const cost         = estimateCost(model, inputTokens, outputTokens);

  await logApiCost({ repoFullName, operation: 'audit', model,
    inputTokens, outputTokens, estimatedCost: cost });

  logger.debug({ repoFullName, cost: cost.toFixed(4) }, 'Audit cost logged');
  return cost;
}

async function trackBuildTaskCost(repoFullName: string, promptLength: string | number, outputLength: string | number): Promise<number> {
  const model        = (process.env['AIDER_MODEL'] as string) || 'claude-sonnet-4-5';
  const inputTokens  = estimateTokens(promptLength);
  const outputTokens = estimateTokens(outputLength);
  const cost         = estimateCost(model, inputTokens, outputTokens);

  await logApiCost({ repoFullName, operation: 'build_task', model,
    inputTokens, outputTokens, estimatedCost: cost });

  return cost;
}

async function trackChatCost(promptLength: string | number, outputLength: string | number): Promise<number> {
  const model        = 'claude-sonnet-4-5';
  const inputTokens  = estimateTokens(promptLength);
  const outputTokens = estimateTokens(outputLength);
  const cost         = estimateCost(model, inputTokens, outputTokens);

  await logApiCost({ repoFullName: undefined, operation: 'chat_response', model,
    inputTokens, outputTokens, estimatedCost: cost });

  return cost;
}

async function getCostReport(): Promise<CostReport> {
  const [daily, monthly, byRepo] = await Promise.all([
    getDailyCost(),
    getMonthlyCost(),
    getCostByRepo(7),
  ]);

  const repoLines = byRepo.slice(0, 8).map((r) =>
    `  ${r.repo_full_name?.split('/')[1] || 'unknown'}: $${parseFloat(r.total).toFixed(3)} (${r.operations} ops)`
  ).join('\n');

  return {
    daily, monthly, byRepo,
    formatted: [
      `💰 API Cost Report`,
      ``,
      `Today:        $${daily.toFixed(3)}`,
      `This month:   $${monthly.toFixed(3)}`,
      ``,
      `By repo (7 days):`,
      repoLines || '  No data yet',
    ].join('\n'),
  };
}

export = {
  trackAuditCost,
  trackBuildTaskCost,
  trackChatCost,
  getCostReport,
};
