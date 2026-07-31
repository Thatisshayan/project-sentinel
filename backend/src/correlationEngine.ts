import { safeFire, fireAndForget } from './utils/safeFire';
import logger from './logger';
import { getLatestMetrics, recordPRImpact, updatePRImpact } from './businessDb';
import { sendTelegramMessage } from './telegramClient';
import dbClient from './dbClient';
import { enqueueScheduledJob } from './queueClient';
import { PR_IMPACT_CHECK_JOB } from './workers/scheduledJobsWorker';
import type { ImpactSnapshot } from './types/businessMetricRow';

async function snapshotBeforeMerge(repoFullName: string, prNumber: string | number, prUrl: string): Promise<number | undefined> {
  const repoName = repoFullName.split('/')[1] || '';
  const metrics  = await getLatestMetrics(repoName);

  const snapshot: ImpactSnapshot = {};
  metrics.forEach((m) => { snapshot[m.metric_name] = parseFloat(m.metric_value || '0'); });

  const impactId = await recordPRImpact({
    repoFullName,
    prNumber: Number(prNumber),
    prUrl,
    mergedAt:    new Date().toISOString(),
    preSnapshot: snapshot,
  });

  if (impactId) {
    await enqueueScheduledJob(
      PR_IMPACT_CHECK_JOB,
      { impactId, repoName },
      48 * 60 * 60 * 1000,
      `pr-impact-check:${impactId}`
    );

    logger.info({ repoFullName, prNumber, impactId }, 'PR impact tracking started');
  }

  return impactId;
}

async function checkPostMergeImpact(impactId: number, repoName: string): Promise<void> {
  try {
    const metrics  = await getLatestMetrics(repoName);
    const snapshot: ImpactSnapshot = {};
    metrics.forEach((m) => { snapshot[m.metric_name] = parseFloat(m.metric_value || '0'); });

    const { delta, score } = await updatePRImpact(impactId, snapshot);
    logger.info({ impactId, score }, 'PR impact analysis complete');

    if (Math.abs(parseFloat(String(score))) >= 5) {
      const direction = parseFloat(String(score)) > 0 ? 'positive ✅' : 'negative ⚠️';

      const deltaLines = Object.entries(delta).map(([key, d]) =>
        `  ${key}: ${d.before} → ${d.after} (${parseFloat(d.changePercent || '0') > 0 ? '+' : ''}${d.changePercent}%)`
      ).join('\n');

      await safeFire(sendTelegramMessage([
        `📊 PR Impact Analysis — ${repoName}`,
        ``,
        `Impact: ${direction} (score: ${score})`,
        `48h after merge:`,
        deltaLines,
      ].join('\n'), repoName, null), { label: 'correlationEngine' })
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message, impactId }, 'Post-merge impact check failed');
  }
}

interface CorrelationSummary {
  avg_impact: string | null;
  pr_count: string;
  positive_prs: string;
  best_impact: string | null;
  worst_impact: string | null;
}

async function getCorrelationSummary(repoName: string): Promise<CorrelationSummary | null> {
  const { query } = dbClient;

  const r = await query<CorrelationSummary>(`
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
