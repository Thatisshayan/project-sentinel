const { logApiCost, getCostByRepo,
        getDailyCost, getMonthlyCost } = require('./portfolioDb');
const logger = require('./logger');

// Approximate cost per 1K tokens (USD)
const COSTS_PER_1K = {
  'claude-sonnet-4-5': { input: 0.003,   output: 0.015   },
  'claude-opus-4-5':   { input: 0.015,   output: 0.075   },
  'claude-sonnet-4-6': { input: 0.003,   output: 0.015   },
  'gemini-2.5-pro':    { input: 0.00125, output: 0.005   },
  'gemini-2.0-flash':  { input: 0.0001,  output: 0.0004  },
  'deepseek-coder':    { input: 0.00014, output: 0.00028 },
  'qwen-max':          { input: 0.0024,  output: 0.0096  },
};

function estimateCost(model, inputTokens, outputTokens) {
  const rates = COSTS_PER_1K[model] || { input: 0.003, output: 0.015 };
  return (inputTokens  / 1000 * rates.input) +
         (outputTokens / 1000 * rates.output);
}

// Rough estimate: 4 chars per token
function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

async function trackAuditCost(repoFullName, promptLength, outputLength) {
  const model        = 'claude-sonnet-4-5';
  const inputTokens  = estimateTokens(promptLength);
  const outputTokens = estimateTokens(outputLength);
  const cost         = estimateCost(model, inputTokens, outputTokens);

  await logApiCost({ repoFullName, operation: 'audit', model,
    inputTokens, outputTokens, estimatedCost: cost });

  logger.debug({ repoFullName, cost: cost.toFixed(4) }, 'Audit cost logged');
  return cost;
}

async function trackBuildTaskCost(repoFullName, promptLength, outputLength) {
  const model        = process.env.AIDER_MODEL || 'claude-sonnet-4-5';
  const inputTokens  = estimateTokens(promptLength);
  const outputTokens = estimateTokens(outputLength);
  const cost         = estimateCost(model, inputTokens, outputTokens);

  await logApiCost({ repoFullName, operation: 'build_task', model,
    inputTokens, outputTokens, estimatedCost: cost });

  return cost;
}

async function trackChatCost(promptLength, outputLength) {
  const model        = 'claude-sonnet-4-5';
  const inputTokens  = estimateTokens(promptLength);
  const outputTokens = estimateTokens(outputLength);
  const cost         = estimateCost(model, inputTokens, outputTokens);

  await logApiCost({ repoFullName: null, operation: 'chat_response', model,
    inputTokens, outputTokens, estimatedCost: cost });

  return cost;
}

async function getCostReport() {
  const [daily, monthly, byRepo] = await Promise.all([
    getDailyCost(),
    getMonthlyCost(),
    getCostByRepo(7),
  ]);

  const repoLines = byRepo.slice(0, 8).map(r =>
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

module.exports = {
  trackAuditCost,
  trackBuildTaskCost,
  trackChatCost,
  getCostReport,
};
