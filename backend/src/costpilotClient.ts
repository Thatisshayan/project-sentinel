import { safeFire, fireAndForget } from './utils/safeFire';
import axios from 'axios';
import logger from './logger';
import {
  logApiCost, getDailyCost, getWeeklyCost, getMonthlyCost, getCostByRepo,
} from './portfolioDb';

const COSTPILOT_API_URL = (): string | undefined => process.env['COSTPILOT_API_URL'];
const COSTPILOT_API_KEY = (): string | undefined => process.env['COSTPILOT_API_KEY'];

function isConfigured(): boolean {
  return !!(COSTPILOT_API_URL() && COSTPILOT_API_KEY());
}

async function logCost(data: any): Promise<void> {
  if (!isConfigured()) {
    await safeFire(logApiCost(data), { label: 'costpilotClient' })
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
  } catch (err: any) {
    logger.warn({ err: err.message }, 'CostPilot unavailable — using local tracker');
    await safeFire(logApiCost(data), { label: 'costpilotClient' })
  }
}

async function getSpendSummary(period = 'today'): Promise<any> {
  if (!isConfigured()) {
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
  } catch (err: any) {
    logger.warn({ err: err.message }, 'CostPilot summary unavailable');
    return { daily: 0, weekly: 0, monthly: 0, source: 'error' };
  }
}

async function getRepoBreakdown(days = 7): Promise<any[]> {
  if (!isConfigured()) {
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
  } catch (err: any) {
    logger.warn({ err: err.message }, 'CostPilot breakdown unavailable');
    return [];
  }
}

export = { logCost, getSpendSummary, getRepoBreakdown, isConfigured };
