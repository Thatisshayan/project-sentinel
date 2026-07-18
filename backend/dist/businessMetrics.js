"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("./logger"));
const businessDb_1 = require("./businessDb");
const today = () => new Date().toISOString().split('T')[0] || '';
async function pullFirebaseMetrics() {
    if (!process.env['FIREBASE_PROJECT_ID'] && !process.env['TAPCASH_METRICS_URL']) {
        logger_1.default.debug('Firebase/TapCash not configured — skipping');
        return;
    }
    const endpoint = process.env['TAPCASH_METRICS_URL'];
    if (!endpoint)
        return;
    try {
        const r = await axios_1.default.get(endpoint, {
            headers: { Authorization: `Bearer ${process.env['TAPCASH_METRICS_KEY']}` },
            timeout: 10000,
        });
        const data = r.data;
        const metrics = [
            { name: 'daily_active_users', value: data.dau, unit: 'count' },
            { name: 'new_users_today', value: data.newUsers, unit: 'count' },
            { name: 'transactions_today', value: data.transactions, unit: 'count' },
            { name: 'revenue_today', value: data.revenueUSD, unit: 'usd' },
            { name: 'avg_session_ms', value: data.avgSessionMs, unit: 'ms' },
        ];
        for (const m of metrics) {
            if (m.value !== undefined && m.value !== null) {
                await (0, businessDb_1.upsertMetric)({
                    repoName: 'tapcash',
                    service: 'firebase_tapcash',
                    metricName: m.name,
                    metricValue: m.value,
                    metricUnit: m.unit,
                    recordedDate: today(),
                });
            }
        }
        logger_1.default.info({ count: metrics.length }, 'Firebase/TapCash metrics pulled');
    }
    catch (err) {
        logger_1.default.warn({ err: err.message }, 'Firebase metrics pull failed — non-blocking');
    }
}
async function recordCustomMetric(repoName, service, metricName, value, unit) {
    await (0, businessDb_1.upsertMetric)({
        repoName, service, metricName,
        metricValue: value,
        metricUnit: unit || 'count',
        recordedDate: today(),
    });
    logger_1.default.debug({ repoName, service, metricName, value }, 'Custom metric recorded');
}
async function pullAllMetrics() {
    logger_1.default.info('Pulling all business metrics');
    const results = await Promise.allSettled([
        pullFirebaseMetrics(),
    ]);
    const connectors = ['Firebase'];
    results.forEach((result, i) => {
        if (result.status === 'rejected') {
            logger_1.default.warn({ connector: connectors[i], err: result.reason.message }, 'Business metrics connector failed');
        }
    });
    logger_1.default.info('Business metrics pull complete');
}
async function getRepoBusinessSummary(repoName) {
    const metrics = await (0, businessDb_1.getLatestMetrics)(repoName);
    if (metrics.length === 0)
        return null;
    const formatted = metrics.map((m) => {
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
//# sourceMappingURL=businessMetrics.js.map