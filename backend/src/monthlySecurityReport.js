const logger = require('./logger');
const { sendTelegramMessage }         = require('./telegramClient');
const { getPortfolioSecuritySummary } = require('./securityDb');

async function generateMonthlySecurityReport() {
  logger.info('Generating monthly security report');

  try {
    const portfolio = await getPortfolioSecuritySummary();
    const sorted    = [...portfolio].sort((a, b) =>
      parseFloat(a.score) - parseFloat(b.score)
    );

    const avg = portfolio.length > 0
      ? (portfolio.reduce((s, r) => s + parseFloat(r.score), 0) / portfolio.length).toFixed(1)
      : 'N/A';

    const totalCritical = portfolio.reduce((s, r) => s + (r.critical_count || 0), 0);
    const totalHigh     = portfolio.reduce((s, r) => s + (r.high_count     || 0), 0);

    const emoji = s => {
      const n = parseFloat(s);
      if (n >= 8) return '🟢';
      if (n >= 6) return '🟡';
      if (n >= 4) return '🟠';
      return '🔴';
    };

    const month = new Date().toLocaleDateString('en-CA', {
      timeZone: 'America/Toronto', month: 'long', year: 'numeric',
    });

    const repoLines = sorted.map(r =>
      `${emoji(r.score)} ${r.repo_name}: ${r.score}/10 ` +
      `(${r.critical_count || 0} critical, ${r.high_count || 0} high)`
    ).join('\n');

    await sendTelegramMessage([
      `🔒 Monthly Security Report — ${month}`,
      ``,
      `Portfolio Score: ${avg}/10`,
      `Open Critical: ${totalCritical}`,
      `Open High: ${totalHigh}`,
      ``,
      `REPOS (worst → best):`,
      repoLines,
      ``,
      sorted.length > 0
        ? `Most vulnerable: ${sorted[0].repo_name} (${sorted[0].score}/10)` : '',
      sorted.length > 0
        ? `Most secure: ${sorted[sorted.length - 1].repo_name} (${sorted[sorted.length - 1].score}/10)` : '',
      ``,
      `/sentinel security <repo> — drill into any repo`,
    ].filter(Boolean).join('\n'), null, null).catch(() => {});

  } catch (err) {
    logger.error({ err: err.message }, 'Monthly security report failed');
  }
}

module.exports = { generateMonthlySecurityReport };
