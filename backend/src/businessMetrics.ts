import axios from 'axios';
import logger from './logger';
import { upsertMetric, getLatestMetrics } from './businessDb';
import type { BusinessMetricRow } from './types/businessMetricRow';

const today = (): string => new Date().toISOString().split('T')[0] || '';

async function pullFirebaseMetrics(): Promise<void> {
  if (!process.env['FIREBASE_PROJECT_ID'] && !process.env['TAPCASH_METRICS_URL']) {
    logger.debug('Firebase/TapCash not configured — skipping');
    return;
  }

  const endpoint = process.env['TAPCASH_METRICS_URL'];
  if (!endpoint) return;

  try {
    const r = await axios.get(endpoint, {
      headers: { Authorization: `Bearer ${process.env['TAPCASH_METRICS_KEY']}` },
      timeout: 10000,
    });

    const data    = r.data;
    const metrics = [
      { name: 'daily_active_users', value: data.dau,          unit: 'count' },
      { name: 'new_users_today',    value: data.newUsers,     unit: 'count' },
      { name: 'transactions_today', value: data.transactions, unit: 'count' },
      { name: 'revenue_today',      value: data.revenueUSD,   unit: 'usd'   },
      { name: 'avg_session_ms',     value: data.avgSessionMs, unit: 'ms'    },
    ];

    for (const m of metrics) {
      if (m.value !== undefined && m.value !== null) {
        await upsertMetric({
          repoName:     'tapcash',
          service:      'firebase_tapcash',
          metricName:   m.name,
          metricValue:  m.value,
          metricUnit:   m.unit,
          recordedDate: today(),
        });
      }
    }

    logger.info({ count: metrics.length }, 'Firebase/TapCash metrics pulled');
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Firebase metrics pull failed — non-blocking');
  }
}

async function recordCustomMetric(repoName: string, service: string, metricName: string, value: number, unit?: string): Promise<void> {
  await upsertMetric({
    repoName, service, metricName,
    metricValue:  value,
    metricUnit:   unit || 'count',
    recordedDate: today(),
  });
  logger.debug({ repoName, service, metricName, value }, 'Custom metric recorded');
}

async function pullAllMetrics(): Promise<void> {
  logger.info('Pulling all business metrics');
  const results = await Promise.allSettled([
    pullFirebaseMetrics(),
  ]);

  const connectors = ['Firebase'];
  results.forEach((result: PromiseSettledResult<void>, i: number) => {
    if (result.status === 'rejected') {
      logger.warn({ connector: connectors[i], err: result.reason.message }, 'Business metrics connector failed');
    }
  });

  logger.info('Business metrics pull complete');
}

async function getRepoBusinessSummary(repoName: string): Promise<string | null> {
  const metrics = await getLatestMetrics(repoName);
  if (metrics.length === 0) return null;

  const formatted = metrics.map((m: BusinessMetricRow) => {
    const numValue = parseFloat(m.metric_value || '0');
    const val = m.metric_unit === 'usd'
      ? `$${numValue.toFixed(2)}`
      : m.metric_unit === 'ms'
      ? `${Math.round(numValue)}ms`
      : numValue.toLocaleString();
    return `${m.metric_name.replace(/_/g, ' ')}: ${val}`;
  }).join('\n');

  return formatted;
}

export = {
  pullAllMetrics,
  pullFirebaseMetrics,
  recordCustomMetric,
  getRepoBusinessSummary,
};
