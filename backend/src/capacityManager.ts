import { getMonthlyCost } from './portfolioDb';
import logger from './logger';
import { nvidiaPoolSize } from './utils/nvidiaKeyPool';
import type { CapacityStatus } from './types/capacityStatus';

const MONTHLY_BUDGET         = (): number => parseFloat(process.env['SPRINT_MONTHLY_BUDGET'] || '30');
const CLAUDE_COST_PER_AUDIT  = 0.08;
const CLAUDE_COST_PER_TASK   = 0.05;

async function getCapacityStatus(): Promise<CapacityStatus> {
  const monthlySpend  = await getMonthlyCost();
  const budget        = MONTHLY_BUDGET();
  const remaining     = budget - monthlySpend;
  const usagePercent  = budget > 0 ? (monthlySpend / budget) * 100 : 0;

  // Was defaulting to 'claude' — Claude Code has no builder config entry
  // (builderRouter.ts dropped it 2026-07-29, no ANTHROPIC_API_KEY
  // configured) and getBuilderConfig() silently redirects it to 'nvidia'
  // anyway, so every "budget healthy" recommendation was already routing
  // through NVIDIA regardless. 'nvidia' is the honest default; there's no
  // Claude quota left to conserve, so the two branches below collapse to
  // the same recommendation the default already gives — kept only for the
  // distinct reason strings shown to the user, and because they're the
  // hook to re-add real budget-based routing once more paid builders exist.
  let recommendedBuilder = 'nvidia';
  let reason             = 'Budget healthy';

  if (usagePercent >= 90) {
    reason = 'Budget at 90%+ — routing to free builder';
  } else if (usagePercent >= 75) {
    reason = 'Budget at 75%+ — conserving quota';
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

// Real, currently-live builder ids only (builderRouter.ts) — this previously
// listed qwen_coder/llama_fast/qwen_max/qwen_plus/qwen_coder_dash/qwen_turbo/
// deepseek, providers dropped from the pool on 2026-07-29 (same drift as
// agentRegistry.ts's AGENT_POOL). Any id missing from this map falls back to
// CLAUDE_COST_PER_TASK (0.05) below — which every one of those real,
// actually-free builder ids was silently doing, inflating the estimated
// monthly spend and risking premature "budget at 75%+" throttling for work
// that costs nothing.
function estimateTaskCost(builderAgent: string, count: number = 1): number {
  const costMap: Record<string, number> = {
    nvidia:            0.0,
    gpt_oss_120b:      0.0,
    llama_8b:          0.0,
    gemini:            0.001,
    mistral_codestral: 0.0,
    openrouter_gemma:  0.0,
    opencode:          0.01,
  };
  return (costMap[builderAgent] ?? 0.0) * count;
}

function selectBuilder(repoName: string, capacity: CapacityStatus, notionBuilder: string): string {
  if (capacity.usagePercent >= 75) {
    // Route to first available free builder. NVIDIA check uses the pool
    // size, not process.env['NVIDIA_API_KEY'] directly — an operator who
    // only sets NVIDIA_API_KEY_2 (documented as valid in .env.example) would
    // otherwise fall through this branch even though NVIDIA is configured.
    if (nvidiaPoolSize() > 0)              { logger.info({ repoName, reason: capacity.reason }, 'Budget routing to NVIDIA'); return 'nvidia'; }
    if (process.env['GEMINI_API_KEY'])     { logger.info({ repoName, reason: capacity.reason }, 'Budget routing to Gemini'); return 'gemini'; }
    if (process.env['MISTRAL_API_KEY'])    { logger.info({ repoName, reason: capacity.reason }, 'Budget routing to Mistral'); return 'mistral_codestral'; }
    if (process.env['OPENROUTER_API_KEY']) { logger.info({ repoName, reason: capacity.reason }, 'Budget routing to OpenRouter'); return 'openrouter_gemma'; }
    logger.warn({ repoName }, 'Budget at 75%+ but no free builder keys set — using nvidia anyway');
  }
  return notionBuilder || 'nvidia';
}

export = { getCapacityStatus, estimateTaskCost, selectBuilder };
