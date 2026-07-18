import { safeFire } from './utils/safeFire';
import logger from './logger';
import { sendTelegramMessage } from './telegramClient';
import {
  getPortfolioSecuritySummary,
  getIssuesFoundSince,
  getIssuesResolvedSince,
} from './securityDb';

const REPORT_WINDOW_DAYS = 30;
const SEVERITY_EMOJI: Record<string, string> = {
  critical: '🔴',
  high:     '🟠',
  medium:   '🟡',
  low:      '⚪',
};

async function generateMonthlySecurityReport(): Promise<void> {
  logger.info('Monthly security report generation triggered');

  try {
    const [portfolio, foundBySeverity, resolvedCount] = await Promise.all([
      getPortfolioSecuritySummary(),
      getIssuesFoundSince(REPORT_WINDOW_DAYS),
      getIssuesResolvedSince(REPORT_WINDOW_DAYS),
    ]);

    if (portfolio.length === 0 && foundBySeverity.length === 0) {
      logger.info('Monthly security report — no security data yet, skipping send');
      return;
    }

    const totalFound = foundBySeverity.reduce((sum, r) => sum + r.count, 0);
    const foundLines = foundBySeverity.length > 0
      ? foundBySeverity.map(r => `  ${SEVERITY_EMOJI[r.severity] || '⚫'} ${r.severity}: ${r.count}`)
      : ['  None found this period.'];

    const sortedPortfolio = [...portfolio].sort(
      (a, b) => parseFloat(a.score ?? '10') - parseFloat(b.score ?? '10')
    );
    const worstRepos = sortedPortfolio
      .filter(r => (r.critical_count || 0) > 0 || (r.high_count || 0) > 0)
      .slice(0, 5)
      .map(r => `  ${r.repo_name}: ${r.score}/10 (${r.critical_count || 0} critical, ${r.high_count || 0} high)`);

    const avgScore = portfolio.length > 0
      ? (portfolio.reduce((sum, r) => sum + parseFloat(r.score || '0'), 0) / portfolio.length).toFixed(1)
      : 'N/A';

    const monthOf = new Date().toLocaleDateString('en-CA', {
      timeZone: 'America/Toronto',
      month: 'long', year: 'numeric',
    });

    const message = [
      `🛡️ Monthly Security Report — ${monthOf}`,
      ``,
      `Portfolio average score: ${avgScore}/10 across ${portfolio.length} repo(s)`,
      ``,
      `New issues found (last ${REPORT_WINDOW_DAYS} days): ${totalFound}`,
      ...foundLines,
      ``,
      `Issues resolved (last ${REPORT_WINDOW_DAYS} days): ${resolvedCount}`,
      ...(worstRepos.length > 0 ? ['', 'Repos needing attention:', ...worstRepos] : []),
    ].join('\n');

    await safeFire(sendTelegramMessage(message, null, null), { label: 'monthlySecurityReport' });

    logger.info(
      { totalFound, resolvedCount, portfolioSize: portfolio.length },
      'Monthly security report sent'
    );
  } catch (err: any) {
    logger.error({ err: err.stack ?? err.message }, 'Monthly security report failed');
  }
}

export = { generateMonthlySecurityReport };
