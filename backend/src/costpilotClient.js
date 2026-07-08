const axios  = require('axios');
const logger = require('./logger');

const COSTPILOT_API_URL = () => process.env.COSTPILOT_API_URL;
const COSTPILOT_API_KEY = () => process.env.COSTPILOT_API_KEY;

function isConfigured() {
  return !!(COSTPILOT_API_URL() && COSTPILOT_API_KEY());
}

async function logCost(data) {
  if (!isConfigured()) {
    const { logApiCost } = require('./portfolioDb');
    await logApiCost(data).catch(() => {});
    return;
  }

  try {
    await axios.post(
      `${COSTPILOT_API_URL()}/api/events`,
      {
        service:    'project-sentinel',
        category:   data.operation,
        model:      data.model,
        repo:       data.repoFullName,
        tokens_in:  data.inputTokens  || 0,
        tokens_out: data.outputTokens || 0,
        cost_usd:   data.estimatedCost || 0,
        metadata: {
          task_type: data.operation,
          repo:      data.repoFullName,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${COSTPILOT_API_KEY()}`,
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      }
    );
  } catch (err) {
    logger.warn({ err: err.message }, 'CostPilot unavailable — using local tracker');
    const { logApiCost } = require('./portfolioDb');
    await logApiCost(data).catch(() => {});
  }
}

async function getSpendSummary(period = 'today') {
  if (!isConfigured()) {
    const { getDailyCost, getWeeklyCost, getMonthlyCost } = require('./portfolioDb');
    const [daily, weekly, monthly] = await Promise.all([getDailyCost(), getWeeklyCost(), getMonthlyCost()]);
    return { daily, weekly, monthly, source: 'local' };
  }

  try {
    const r = await axios.get(
      `${COSTPILOT_API_URL()}/api/summary?service=project-sentinel&period=${period}`,
      {
        headers: { Authorization: `Bearer ${COSTPILOT_API_KEY()}` },
        timeout: 5000,
      }
    );
    return { ...r.data, source: 'costpilot' };
  } catch (err) {
    logger.warn({ err: err.message }, 'CostPilot summary unavailable');
    return { daily: 0, weekly: 0, monthly: 0, source: 'error' };
  }
}

async function getRepoBreakdown(days = 7) {
  if (!isConfigured()) {
    const { getCostByRepo } = require('./portfolioDb');
    return getCostByRepo(days).catch(() => []);
  }

  try {
    const r = await axios.get(
      `${COSTPILOT_API_URL()}/api/breakdown?service=project-sentinel&days=${days}&group_by=repo`,
      {
        headers: { Authorization: `Bearer ${COSTPILOT_API_KEY()}` },
        timeout: 5000,
      }
    );
    return r.data.items || [];
  } catch (err) {
    logger.warn({ err: err.message }, 'CostPilot breakdown unavailable');
    return [];
  }
}

module.exports = { logCost, getSpendSummary, getRepoBreakdown, isConfigured };
