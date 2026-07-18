"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const safeFire_1 = require("./utils/safeFire");
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("./logger"));
const dbClient_1 = require("./dbClient");
const businessDb_1 = require("./businessDb");
async function fetchAllMetrics() {
    const today = new Date().toISOString().split('T')[0] || '';
    let envSources = [];
    try {
        if (process.env['METRICS_SOURCES']) {
            envSources = JSON.parse(process.env['METRICS_SOURCES']);
        }
    }
    catch (e) {
        logger_1.default.warn({ err: e.message }, 'METRICS_SOURCES is not valid JSON — skipping env sources');
    }
    const dbResult = await (0, dbClient_1.query)('SELECT connector_name, repo_name, config, last_pull_at FROM metric_connectors WHERE is_active = true').catch(() => ({ rows: [] }));
    const dbSources = dbResult.rows.map((r) => ({
        name: r.connector_name,
        repo: r.repo_name,
        url: r.config?.url,
        auth: r.config?.auth,
        headers: r.config?.headers || {},
        fromDb: true,
    })).filter((s) => s.url);
    const allSources = [...envSources, ...dbSources];
    if (allSources.length === 0) {
        logger_1.default.info('No metric connectors configured — set METRICS_SOURCES or add rows to metric_connectors');
        return;
    }
    let fetched = 0;
    let failed = 0;
    for (const source of allSources) {
        try {
            await fetchOne(source, today);
            fetched++;
        }
        catch (err) {
            failed++;
            logger_1.default.warn({ source: source.name, err: err.message }, 'Metrics fetch failed');
            if (source.fromDb) {
                await (0, safeFire_1.safeFire)((0, dbClient_1.query)('UPDATE metric_connectors SET last_error = $2 WHERE connector_name = $1', [source.name, err.message.substring(0, 500)]), { label: 'metricsFetcher' });
            }
        }
    }
    logger_1.default.info({ fetched, failed, total: allSources.length }, 'Metrics fetch complete');
}
async function fetchOne(source, today) {
    const { name, repo, url, auth, headers: extraHeaders = {} } = source;
    if (!url)
        throw new Error('No URL configured');
    if (!repo)
        throw new Error('No repo_name configured');
    const headers = { ...extraHeaders };
    if (auth)
        headers['Authorization'] = auth;
    const response = await axios_1.default.get(url, { headers, timeout: 15000 });
    const data = response.data;
    if (Array.isArray(data)) {
        for (const item of data) {
            if (!item.name && !item.metric_name)
                continue;
            await (0, businessDb_1.upsertMetric)({
                repoName: repo,
                service: name,
                metricName: item.name || item.metric_name,
                metricValue: parseFloat(item.value ?? item.metric_value ?? 0),
                metricUnit: item.unit || 'count',
                recordedDate: today,
            });
        }
    }
    else if (data && typeof data === 'object') {
        for (const [key, val] of Object.entries(data)) {
            if (typeof val !== 'number')
                continue;
            await (0, businessDb_1.upsertMetric)({
                repoName: repo, service: name, metricName: key,
                metricValue: val, metricUnit: 'count', recordedDate: today,
            });
        }
    }
    await (0, safeFire_1.safeFire)((0, dbClient_1.query)('UPDATE metric_connectors SET last_pull_at = NOW(), last_error = NULL WHERE connector_name = $1', [name]), { label: 'metricsFetcher' });
    logger_1.default.info({ source: name, repo }, 'Metrics fetched');
}
module.exports = { fetchAllMetrics };
//# sourceMappingURL=metricsFetcher.js.map