import logger from './logger';
import { getLatestMetrics, recordPRImpact, updatePRImpact } from './businessDb';

async function snapshotBeforeMerge(repoFullName: string, prNumber: string | number, prUrl: string): Promise<any> {
  const repoName = repoFullName.split('/')[1] || '';
  const metrics  = await getLatestMetrics(repoName);

  const snapshot: Record<string, number> = {};
  metrics.forEach((m: any) => { snapshot[m.metric_name] = parseFloat(m.metric_value); });

  const impactId = await recordPRImpact({
    repoFullName,
    prNumber: Number(prNumber),
    prUrl,
    mergedAt:    new Date().toISOString(),
    preSnapshot: snapshot,
  });

  if (impactId) {
    setTimeout(async () => {
      await checkPostMergeImpact(impactId, repoName);
    }, 48 * 60 * 60 * 1000);

    logger.info({ repoFullName, prNumber, impactId }, 'PR impact tracking started');
  }

  return impactId;
}

async function checkPostMergeImpact(impactId: any, repoName: string): Promise<void> {
  try {
    const metrics  = await getLatestMetrics(repoName);
    const snapshot: Record<string, number> = {};
    metrics.forEach((m: any) => { snapshot[m.metric_name] = parseFloat(m.metric_value); });

    const { delta, score } = await updatePRImpact(impactId, snapshot);
    logger.info({ impactId, score }, 'PR impact analysis complete');

    if (Math.abs(parseFloat(String(score))) >= 5) {
      const { sendTelegramMessage } = require('./telegramClient') as { sendTelegramMessage: (...args: any[]) => Promise<any> };
      const direction = parseFloat(String(score)) > 0 ? 'positive ✅' : 'negative ⚠️';

      const deltaLines = Object.entries(delta).map(([key, d]: [string, any]) =>
        `  ${key}: ${d.before} → ${d.after} (${parseFloat(d.changePercent) > 0 ? '+' : ''}${d.changePercent}%)`
      ).join('\n');

      await sendTelegramMessage([
        `📊 PR Impact Analysis — ${repoName}`,
        ``,
        `Impact: ${direction} (score: ${score})`,
        `48h after merge:`,
        deltaLines,
      ].join('\n'), null, null).catch(() => {});
    }
  } catch (err: any) {
    logger.warn({ err: err.message, impactId }, 'Post-merge impact check failed');
  }
}

async function getCorrelationSummary(repoName: string): Promise<any> {
  const { query } = require('./dbClient') as { query: (...args: any[]) => Promise<any> };

  const r = await query(`
    SELECT
      AVG(impact_score)                                         as avg_impact,
      COUNT(*)                                                  as pr_count,
      SUM(CASE WHEN impact_score > 0 THEN 1 ELSE 0 END)        as positive_prs,
      MAX(impact_score)                                         as best_impact,
      MIN(impact_score)                                         as worst_impact
    FROM pr_impact
    WHERE repo_full_name LIKE $1
      AND analysis_complete = true
      AND merged_at > NOW() - INTERVAL '30 days'
  `, [`%/${repoName}`]);

  return r.rows[0] || null;
}

export = { snapshotBeforeMerge, checkPostMergeImpact, getCorrelationSummary };
