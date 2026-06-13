const logger = require('./logger');
const { getLatestMetrics, recordPRImpact, updatePRImpact } = require('./businessDb');

async function snapshotBeforeMerge(repoFullName, prNumber, prUrl) {
  const repoName = repoFullName.split('/')[1];
  const metrics  = await getLatestMetrics(repoName);

  const snapshot = {};
  metrics.forEach(m => { snapshot[m.metric_name] = parseFloat(m.metric_value); });

  const impactId = await recordPRImpact({
    repoFullName,
    prNumber,
    prUrl,
    mergedAt:    new Date().toISOString(),
    preSnapshot: snapshot,
  });

  if (impactId) {
    // Best-effort 48h post-merge check — survives only if process stays up
    setTimeout(async () => {
      await checkPostMergeImpact(impactId, repoName);
    }, 48 * 60 * 60 * 1000);

    logger.info({ repoFullName, prNumber, impactId }, 'PR impact tracking started');
  }

  return impactId;
}

async function checkPostMergeImpact(impactId, repoName) {
  try {
    const metrics  = await getLatestMetrics(repoName);
    const snapshot = {};
    metrics.forEach(m => { snapshot[m.metric_name] = parseFloat(m.metric_value); });

    const { delta, score } = await updatePRImpact(impactId, snapshot);
    logger.info({ impactId, score }, 'PR impact analysis complete');

    if (Math.abs(parseFloat(score)) >= 5) {
      const { sendTelegramMessage } = require('./telegramClient');
      const direction = parseFloat(score) > 0 ? 'positive ✅' : 'negative ⚠️';

      const deltaLines = Object.entries(delta).map(([key, d]) =>
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
  } catch (err) {
    logger.warn({ err: err.message, impactId }, 'Post-merge impact check failed');
  }
}

async function getCorrelationSummary(repoName) {
  const { query } = require('./dbClient');

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

module.exports = { snapshotBeforeMerge, checkPostMergeImpact, getCorrelationSummary };
