import { sendTelegramMessage } from './telegramClient';
import { refreshAllMetrics, getPortfolioSummary } from './portfolioAnalytics';
import { getOpenPatterns, getDailyCost, getMonthlyCost } from './portfolioDb';
import { query } from './dbClient';
import { getPortfolioSecuritySummary } from './securityDb';
import logger from './logger';
import type { PortfolioMetricRow, PortfolioSummary, RepoPatternRow } from './types/portfolioRow';

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const STATUS_EMOJI: Record<string, string>   = { passing: '🟢', failed: '🔴', unknown: '⚪', building: '🟡' };
const PRIORITY_EMOJI: Record<string, string> = { critical: '🚨', high: '⚠️', medium: '📋', low: '💤' };

async function buildReportMessage(summary: PortfolioSummary, patterns: RepoPatternRow[]): Promise<string> {
  const { metrics, avgHealth, dailyCost, monthlyCost,
          healthy, broken, unknown } = summary;

  const today = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Toronto',
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const sorted = [...metrics].sort((a: PortfolioMetricRow, b: PortfolioMetricRow) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 2;
    const pb = PRIORITY_ORDER[b.priority] ?? 2;
    if (pa !== pb) return pa - pb;
    return parseFloat(b.health_score || '0') - parseFloat(a.health_score || '0');
  });

  const repoLines = sorted.map((m: PortfolioMetricRow) => {
    const status  = STATUS_EMOJI[m.build_status || 'unknown']  || '⚪';
    const pri     = PRIORITY_EMOJI[m.priority]    || '📋';
    const tasks   = m.tasks_queued > 0 ? ` · ${m.tasks_queued} tasks queued` : '';
    const fails   = m.builds_failed > 0
      ? ` · ${m.builds_failed} fail${m.builds_failed > 1 ? 's' : ''}` : '';
    return `${status} ${pri} ${m.repo_name}${fails}${tasks}`;
  }).join('\n');

  const totalTasksDone    = metrics.reduce((s: number, m: PortfolioMetricRow) => s + (m.tasks_done    || 0), 0);
  const totalTasksQueued  = metrics.reduce((s: number, m: PortfolioMetricRow) => s + (m.tasks_queued  || 0), 0);
  const totalBuildsPassed = metrics.reduce((s: number, m: PortfolioMetricRow) => s + (m.builds_passed || 0), 0);
  const totalBuildsFailed = metrics.reduce((s: number, m: PortfolioMetricRow) => s + (m.builds_failed || 0), 0);

  const staleThresholdHours = parseInt(process.env['STALE_AUDIT_CYCLE_ALERT_HOURS'] || '24', 10);
  const staleCyclesResult = await query(`
    SELECT repo_full_name, status, created_at,
           EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 AS age_hours
    FROM audit_cycles
    WHERE status IN ('awaiting_approval', 'executing')
      AND created_at < NOW() - ($1 || ' hours')::interval
    ORDER BY created_at ASC
  `, [staleThresholdHours]);

  const staleCycles = staleCyclesResult.rows as Array<{
    repo_full_name: string;
    status: string;
    created_at: string;
    age_hours: string | number;
  }>;
  const oldestStaleCycle = staleCycles[0];
  const oldestStaleHours = oldestStaleCycle ? Number(oldestStaleCycle.age_hours) : 0;
  const staleLine = oldestStaleCycle
    ? [
        `\n⏳ Stale audit cycles: ${staleCycles.length} pending/executing older than ${staleThresholdHours}h`,
        `   Oldest: ${oldestStaleCycle.repo_full_name} (${Math.floor(oldestStaleHours / 24)}d ${Math.floor(oldestStaleHours % 24)}h old, ${oldestStaleCycle.status})`,
      ].join('\n')
    : '';

  const backlogThreshold = parseInt(process.env['AUDIT_BACKLOG_ALERT_COUNT'] || '3', 10);
  const backlogResult = await query(`
    SELECT repo_full_name, COUNT(*) AS queued_count,
           MIN(created_at) AS oldest_queued_at
    FROM audit_tasks
    WHERE status = 'queued'
    GROUP BY repo_full_name
    HAVING COUNT(*) >= $1
    ORDER BY queued_count DESC, oldest_queued_at ASC
  `, [backlogThreshold]);
  const backlogRows = backlogResult.rows as Array<{
    repo_full_name: string;
    queued_count: string | number;
    oldest_queued_at: string | null;
  }>;
  const backlogLine = backlogRows.length > 0
    ? [
        `\n📋 Audit backlog: ${backlogRows.length} repos have ${backlogThreshold}+ queued tasks`,
        ...backlogRows.slice(0, 5).map((r) =>
          `   · ${r.repo_full_name}: ${Number(r.queued_count)} queued${r.oldest_queued_at ? ` (oldest ${r.oldest_queued_at})` : ''}`
        ),
      ].join('\n')
    : '';

  const patternLines = patterns.length > 0
    ? '\n🔍 Cross-repo patterns detected:\n' +
      patterns.slice(0, 3).map((p: RepoPatternRow) =>
        `  · ${p.description} (${p.affected_repos?.length || 0} repos)`
      ).join('\n')
    : '';

  const costLine = dailyCost > 0
    ? `\n💰 API spend: $${dailyCost.toFixed(2)} today · $${monthlyCost.toFixed(2)} this month`
    : '';

  return [
    `🛡️ Project Sentinel — Daily Report`,
    `${today}`,
    ``,
    `Portfolio Health: ${avgHealth}/10`,
    `🟢 ${healthy.length} healthy  🔴 ${broken.length} broken  ⚪ ${unknown.length} unknown`,
    ``,
    `REPOS:`,
    repoLines,
    ``,
    `ACTIVITY (last 24h):`,
    `✅ ${totalBuildsPassed} builds passed  ❌ ${totalBuildsFailed} failed`,
    `🔧 ${totalTasksDone} tasks completed  📋 ${totalTasksQueued} queued`,
    staleLine,
    backlogLine,
    patternLines,
    costLine,
    ``,
    `Quick commands:`,
    `/sentinel execute <repo>  — run pending tasks`,
    `/sentinel audit <repo>    — trigger manual audit`,
    `/sentinel status <repo>   — repo details`,
  ].filter((l: string | null) => l !== null).join('\n');
}

async function sendDailyReport(): Promise<void> {
  logger.info('Generating daily portfolio report');

  try {
    const [summary, patterns] = await Promise.all([
      (async () => { await refreshAllMetrics(); return getPortfolioSummary(); })(),
      getOpenPatterns(),
    ]);

    let message     = await buildReportMessage(summary, patterns);
    const dailyCost   = await getDailyCost();
    const monthlyCost = await getMonthlyCost();

    const secPortfolio  = await getPortfolioSecuritySummary().catch(() => []);
    const criticalRepos = secPortfolio.filter((r) => r.critical_count > 0);
    if (criticalRepos.length > 0) {
      message += '\n\n🔒 Security Alerts:\n' +
        criticalRepos.map((r) =>
          `  · ${r.repo_name}: ${r.critical_count} critical open`
        ).join('\n');
    }

    await sendTelegramMessage(message, null, null);

    const today = new Date().toISOString().split('T')[0];
    await query(`
      INSERT INTO daily_reports
        (report_date, health_average, builds_passed, builds_failed,
         tasks_completed, daily_cost, monthly_cost, telegram_sent, sent_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,true,NOW())
      ON CONFLICT (report_date) DO UPDATE SET
        health_average = EXCLUDED.health_average,
        telegram_sent  = true,
        sent_at        = NOW()
    `, [
      today,
      summary.avgHealth,
      summary.metrics.reduce((s: number, m: PortfolioMetricRow) => s + (m.builds_passed || 0), 0),
      summary.metrics.reduce((s: number, m: PortfolioMetricRow) => s + (m.builds_failed || 0), 0),
      summary.metrics.reduce((s: number, m: PortfolioMetricRow) => s + (m.tasks_done    || 0), 0),
      dailyCost, monthlyCost,
    ]);

    logger.info('Daily report sent');

  } catch (err) {
    const e = err as Error;
    logger.error({ err: e.stack ?? e.message }, 'Daily report failed');
  }
}

export = { sendDailyReport };

