const logger = require('./logger');
const { sendTelegramMessage }   = require('./telegramClient');
const { getPortfolioSummary }   = require('./portfolioAnalytics');
const { getSpendSummary }       = require('./costpilotClient');
const { getLatestMetrics }      = require('./businessDb');
const { getVelocityReport }     = require('./velocityTracker');
const { getCorrelationSummary } = require('./correlationEngine');

const REVENUE_REPOS = ['tapcash', 'acc', 'costpilot'];

async function generateWeeklyReport() {
  logger.info('Generating weekly business + technical report');

  try {
    const [summary, spend, velocity] = await Promise.all([
      getPortfolioSummary(),
      getSpendSummary('week'),
      getVelocityReport(),
    ]);

    // Technical summary
    const techLines = [
      `📊 Portfolio Health: ${summary.avgHealth}/10`,
      `✅ Healthy: ${summary.healthy.length}  ❌ Broken: ${summary.broken.length}`,
    ];

    // Business metrics for revenue repos
    const bizLines = [];
    for (const repoName of REVENUE_REPOS) {
      const metrics = await getLatestMetrics(repoName).catch(() => []);
      if (metrics.length === 0) continue;

      const revenue = metrics.find(m => m.metric_name === 'revenue_today');
      const dau     = metrics.find(m => m.metric_name === 'daily_active_users');
      const corr    = await getCorrelationSummary(repoName).catch(() => null);

      const parts = [];
      if (revenue) parts.push(`Revenue: $${parseFloat(revenue.metric_value).toFixed(0)}/day`);
      if (dau)     parts.push(`DAU: ${parseInt(dau.metric_value).toLocaleString()}`);
      if (corr && corr.pr_count > 0) {
        parts.push(`PR impact: ${parseFloat(corr.avg_impact).toFixed(1)} avg score`);
      }

      if (parts.length > 0) {
        bizLines.push(`${repoName}: ${parts.join(' · ')}`);
      }
    }

    // Cost summary
    const costLines = spend.source !== 'error' ? [
      `💰 API spend this week: $${(spend.weekly || 0).toFixed(2)}`,
      `   Month to date: $${(spend.monthly || 0).toFixed(2)}`,
    ] : [];

    const sorted     = [...summary.metrics].sort((a, b) => parseFloat(b.health_score) - parseFloat(a.health_score));
    const topRepo    = sorted[0];
    const bottomRepo = sorted[sorted.length - 1];

    const weekOf = new Date().toLocaleDateString('en-CA', {
      timeZone: 'America/Toronto',
      month: 'long', day: 'numeric', year: 'numeric',
    });

    await sendTelegramMessage([
      `🛡️ Sentinel Weekly Report — ${weekOf}`,
      ``,
      `TECHNICAL`,
      ...techLines,
      topRepo    ? `📈 Most improved: ${topRepo.repo_name} (${topRepo.health_score}/10)`       : null,
      bottomRepo ? `📉 Needs attention: ${bottomRepo.repo_name} (${bottomRepo.health_score}/10)` : null,
      ``,
      bizLines.length > 0 ? 'BUSINESS' : null,
      ...bizLines,
      ``,
      velocity,
      ``,
      ...costLines,
    ].filter(l => l !== null).join('\n'), null, null).catch(() => {});

    logger.info('Weekly business report sent');
  } catch (err) {
    logger.error({ err: err.message }, 'Weekly business report failed');
  }
}

module.exports = { generateWeeklyReport };
