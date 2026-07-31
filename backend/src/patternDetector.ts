import { safeFire, fireAndForget } from './utils/safeFire';
import logger from './logger';
import { query } from './dbClient';
import { upsertPattern, getOpenPatterns } from './portfolioDb';
import { sendTelegramMessage } from './telegramClient';

const PATTERN_THRESHOLD = (): number =>
  parseInt(process.env['PATTERN_DETECTION_THRESHOLD'] || '3');

interface DetectedPattern {
  type: 'error' | 'task';
  repos: string[];
  description: string;
}

interface FailurePatternRow {
  pattern: string;
  repos: string[];
  repo_count: string;
}

interface TaskPatternRow {
  category: string;
  priority: string;
  repos: string[];
  repo_count: string;
}

async function detectPatterns(): Promise<DetectedPattern[]> {
  logger.info('Running cross-repo pattern detection');

  const detected: DetectedPattern[] = [];

  const failurePatterns = await query<FailurePatternRow>(`
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
      severity:      parseInt(row.repo_count, 10) >= 5 ? 'high' : 'medium',
    });
    detected.push({ type: 'error', repos: row.repos, description: row.pattern });
  }

  const taskPatterns = await query<TaskPatternRow>(`
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

  const notable = detected.filter((d) => d.repos.length >= PATTERN_THRESHOLD());

  if (notable.length > 0) {
    const lines = notable.slice(0, 3).map((p) =>
      `· ${p.description} (${p.repos.length} repos: ${p.repos.map((r) => r.split('/')[1]).join(', ')})`
    ).join('\n');

    await safeFire(sendTelegramMessage(
      `Project Sentinel — Portfolio Patterns Detected 🔍\n\n${lines}\n\nThese issues affect multiple repos. Consider a batch fix.`,
      null, null
    ), { label: 'patternDetector' })
  }

  logger.info({ detected: detected.length }, 'Pattern detection complete');
  return detected;
}

export = { detectPatterns };
