const axios  = require('axios');
const logger = require('./logger');
const { query }        = require('./dbClient');
const { upsertMetric } = require('./businessDb');

// Reads metrics from HTTP endpoints and stores them in business_metrics.
//
// Configure via Railway env var:
//   METRICS_SOURCES = JSON array of connector objects:
//   [
//     { "name": "tapcash", "repo": "tapcash", "url": "https://...", "auth": "Bearer xxx" },
//     { "name": "alphonso-api", "repo": "AlphonsoEcosystem", "url": "...", "type": "array" }
//   ]
//
// Response format supported:
//   Flat object:  { "revenue": 5000, "dau": 1200 }
//   Array:        [{ "name": "revenue", "value": 5000, "unit": "USD" }]

async function fetchAllMetrics() {
  const today = new Date().toISOString().split('T')[0];

  // Sources from env var
  let envSources = [];
  try {
    if (process.env.METRICS_SOURCES) {
      envSources = JSON.parse(process.env.METRICS_SOURCES);
    }
  } catch (e) {
    logger.warn({ err: e.message }, 'METRICS_SOURCES is not valid JSON — skipping env sources');
  }

  // Sources from DB connector table
  const dbResult = await query(
    'SELECT connector_name, repo_name, config, last_pull_at FROM metric_connectors WHERE is_active = true'
  ).catch(() => ({ rows: [] }));

  const dbSources = dbResult.rows.map(r => ({
    name:    r.connector_name,
    repo:    r.repo_name,
    url:     r.config?.url,
    auth:    r.config?.auth,
    headers: r.config?.headers || {},
    fromDb:  true,
  })).filter(s => s.url);

  const allSources = [...envSources, ...dbSources];

  if (allSources.length === 0) {
    logger.info('No metric connectors configured — set METRICS_SOURCES or add rows to metric_connectors');
    return;
  }

  let fetched = 0;
  let failed  = 0;

  for (const source of allSources) {
    try {
      await fetchOne(source, today);
      fetched++;
    } catch (err) {
      failed++;
      logger.warn({ source: source.name, err: err.message }, 'Metrics fetch failed');
      if (source.fromDb) {
        await query(
          'UPDATE metric_connectors SET last_error = $2 WHERE connector_name = $1',
          [source.name, err.message.substring(0, 500)]
        ).catch(() => {});
      }
    }
  }

  logger.info({ fetched, failed, total: allSources.length }, 'Metrics fetch complete');
}

async function fetchOne(source, today) {
  const { name, repo, url, auth, headers: extraHeaders = {} } = source;

  if (!url)  throw new Error('No URL configured');
  if (!repo) throw new Error('No repo_name configured');

  const headers = { ...extraHeaders };
  if (auth) headers['Authorization'] = auth;

  const response = await axios.get(url, { headers, timeout: 15000 });
  const data     = response.data;

  if (Array.isArray(data)) {
    for (const item of data) {
      if (!item.name && !item.metric_name) continue;
      await upsertMetric({
        repoName:    repo,
        service:     name,
        metricName:  item.name || item.metric_name,
        metricValue: parseFloat(item.value ?? item.metric_value ?? 0),
        metricUnit:  item.unit || 'count',
        recordedDate: today,
      });
    }
  } else if (data && typeof data === 'object') {
    for (const [key, val] of Object.entries(data)) {
      if (typeof val !== 'number') continue;
      await upsertMetric({
        repoName: repo, service: name, metricName: key,
        metricValue: val, metricUnit: 'count', recordedDate: today,
      });
    }
  }

  await query(
    'UPDATE metric_connectors SET last_pull_at = NOW(), last_error = NULL WHERE connector_name = $1',
    [name]
  ).catch(() => {});

  logger.info({ source: name, repo }, 'Metrics fetched');
}

module.exports = { fetchAllMetrics };
