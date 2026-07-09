const axios  = require('axios');
const logger = require('./logger');
const { upsertMetric, getLatestMetrics } = require('./businessDb');

const today = () => new Date().toISOString().split('T')[0];

// ── Firebase / TapCash connector ──────────────────────────────────────────────

async function pullFirebaseMetrics() {
  if (!process.env.FIREBASE_PROJECT_ID && !process.env.TAPCASH_METRICS_URL) {
    logger.debug('Firebase/TapCash not configured — skipping');
    return;
  }

  const endpoint = process.env.TAPCASH_METRICS_URL;
  if (!endpoint) return;

  try {
    const r = await axios.get(endpoint, {
      headers: { Authorization: `Bearer ${process.env.TAPCASH_METRICS_KEY}` },
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
  } catch (err) {
    logger.warn({ err: err.message }, 'Firebase metrics pull failed — non-blocking');
  }
}

// ── Generic custom metric recorder ───────────────────────────────────────────

async function recordCustomMetric(repoName, service, metricName, value, unit) {
  await upsertMetric({
    repoName, service, metricName,
    metricValue:  value,
    metricUnit:   unit || 'count',
    recordedDate: today(),
  });
  logger.debug({ repoName, service, metricName, value }, 'Custom metric recorded');
}

// ── Pull all configured connectors ────────────────────────────────────────────

async function pullAllMetrics() {
  logger.info('Pulling all business metrics');
  const results = await Promise.allSettled([
    pullFirebaseMetrics(),
    // Add more connectors here as services are connected
  ]);

  const connectors = ['Firebase'];
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      logger.warn({ connector: connectors[i], err: result.reason.message }, 'Business metrics connector failed');
    }
  });

  logger.info('Business metrics pull complete');
}

// ── Formatted summary for a repo ─────────────────────────────────────────────

async function getRepoBusinessSummary(repoName) {
  const metrics = await getLatestMetrics(repoName);
  if (metrics.length === 0) return null;

  const formatted = metrics.map(m => {
    const val = m.metric_unit === 'usd'
      ? `$${parseFloat(m.metric_value).toFixed(2)}`
      : m.metric_unit === 'ms'
      ? `${Math.round(m.metric_value)}ms`
      : parseFloat(m.metric_value).toLocaleString();
    return `${m.metric_name.replace(/_/g, ' ')}: ${val}`;
  }).join('\n');

  return formatted;
}

module.exports = {
  pullAllMetrics,
  pullFirebaseMetrics,
  recordCustomMetric,
  getRepoBusinessSummary,
};
