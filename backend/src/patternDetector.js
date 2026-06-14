const logger = require('./logger');
const { query }               = require('./dbClient');
const { upsertPattern,
        getOpenPatterns }     = require('./portfolioDb');
const { sendTelegramMessage } = require('./telegramClient');

const PATTERN_THRESHOLD = () =>
  parseInt(process.env.PATTERN_DETECTION_THRESHOLD || '3');

async function detectPatterns() {
  logger.info('Running cross-repo pattern detection');

  const detected = [];

  // Pattern 1: Same build failure message across repos
  const failurePatterns = await query(`
    SELECT
      LOWER(SUBSTRING(failure_reason, 1, 100)) as pattern,
      ARRAY_AGG(DISTINCT repo_full_name) as repos,
      COUNT(DISTINCT repo_full_name) as repo_count
    FROM debug_attempts
    WHERE created_at > NOW() - INTERVAL '7 days'
      AND failure_reason IS NOT NULL
      AND failure_reason != ''
      AND status IN ('failed','exhausted')
    GROUP BY LOWER(SUBSTRING(failure_reason, 1, 100))
    HAVING COUNT(DISTINCT repo_full_name) >= $1
    ORDER BY repo_count DESC
    LIMIT 10
  `, [PATTERN_THRESHOLD()]);

  for (const row of failurePatterns.rows) {
    await upsertPattern({
      patternType:   'error',
      patternKey:    `error:${row.pattern}`,
      description:   `Build failure: "${row.pattern.substring(0, 80)}"`,
      affectedRepos: row.repos,
      severity:      row.repo_count >= 5 ? 'high' : 'medium',
    });
    detected.push({ type: 'error', repos: row.repos, description: row.pattern });
  }

  // Pattern 2: Same audit task category appearing across repos
  const taskPatterns = await query(`
    SELECT
      category,
      priority,
      ARRAY_AGG(DISTINCT repo_full_name) as repos,
      COUNT(DISTINCT repo_full_name) as repo_count
    FROM audit_tasks
    WHERE status = 'queued'
      AND created_at > NOW() - INTERVAL '14 days'
    GROUP BY category, priority
    HAVING COUNT(DISTINCT repo_full_name) >= $1
    ORDER BY repo_count DESC
    LIMIT 10
  `, [PATTERN_THRESHOLD()]);

  for (const row of taskPatterns.rows) {
    await upsertPattern({
      patternType:   'improvement',
      patternKey:    `task:${row.category}:${row.priority}`,
      description:   `${row.priority} ${row.category} improvement needed across portfolio`,
      affectedRepos: row.repos,
      severity:      row.priority === 'critical' ? 'high' : 'medium',
    });
    detected.push({ type: 'task', repos: row.repos,
      description: `${row.priority} ${row.category}` });
  }

  // Alert on patterns affecting threshold+ repos
  const notable = detected.filter(d => d.repos.length >= PATTERN_THRESHOLD());

  if (notable.length > 0) {
    const lines = notable.slice(0, 3).map(p =>
      `· ${p.description} (${p.repos.length} repos: ${p.repos.map(r => r.split('/')[1]).join(', ')})`
    ).join('\n');

    await sendTelegramMessage(
      `Project Sentinel — Portfolio Patterns Detected 🔍\n\n${lines}\n\nThese issues affect multiple repos. Consider a batch fix.`,
      null, null
    ).catch(() => {});
  }

  logger.info({ detected: detected.length }, 'Pattern detection complete');
  return detected;
}

module.exports = { detectPatterns };
