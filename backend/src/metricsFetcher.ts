import { safeFire, fireAndForget } from './utils/safeFire';
import axios from 'axios';
import logger from './logger';
import { query } from './dbClient';
import { upsertMetric } from './businessDb';

interface MetricSource {
  name: string;
  repo: string;
  url?: string;
  auth?: string;
  headers?: Record<string, string>;
  fromDb?: boolean;
}

interface MetricConnectorRow {
  connector_name: string;
  repo_name: string;
  config: { url?: string; auth?: string; headers?: Record<string, string> } | null;
  last_pull_at: string | null;
}

async function fetchAllMetrics(): Promise<void> {
  const today = new Date().toISOString().split('T')[0] || '';

  let envSources: MetricSource[] = [];
  try {
    if (process.env['METRICS_SOURCES']) {
      envSources = JSON.parse(process.env['METRICS_SOURCES']);
    }
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'METRICS_SOURCES is not valid JSON — skipping env sources');
  }

  const dbResult = await query<MetricConnectorRow>(
    'SELECT connector_name, repo_name, config, last_pull_at FROM metric_connectors WHERE is_active = true'
  ).catch(() => ({ rows: [] as MetricConnectorRow[] }));

  const dbSources: MetricSource[] = dbResult.rows.map((r) => ({
    name:    r.connector_name,
    repo:    r.repo_name,
    url:     r.config?.url,
    auth:    r.config?.auth,
    headers: r.config?.headers || {},
    fromDb:  true,
  })).filter((s) => s.url);

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
      const e = err as Error;
      logger.warn({ source: source.name, err: e.message }, 'Metrics fetch failed');
      if (source.fromDb) {
        await safeFire(query(
          'UPDATE metric_connectors SET last_error = $2 WHERE connector_name = $1',
          [source.name, e.message.substring(0, 500)]
        ), { label: 'metricsFetcher' })
      }
    }
  }

  logger.info({ fetched, failed, total: allSources.length }, 'Metrics fetch complete');
}

async function fetchOne(source: MetricSource, today: string): Promise<void> {
  const { name, repo, url, auth, headers: extraHeaders = {} } = source;

  if (!url)  throw new Error('No URL configured');
  if (!repo) throw new Error('No repo_name configured');

  const headers: Record<string, string> = { ...extraHeaders };
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

  await safeFire(query(
    'UPDATE metric_connectors SET last_pull_at = NOW(), last_error = NULL WHERE connector_name = $1',
    [name]
  ), { label: 'metricsFetcher' })

  logger.info({ source: name, repo }, 'Metrics fetched');
}

export = { fetchAllMetrics };
