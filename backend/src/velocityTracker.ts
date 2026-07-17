import { query } from './dbClient';
import { recordVelocity, getVelocityTrend } from './sprintDb';
import { getAllLatestMetrics, getMonthlyCost } from './portfolioDb';
import logger from './logger';

function getWeekStart(date: Date = new Date()): string {
  const d   = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0] || '';
}

async function recordWeeklyVelocity(): Promise<void> {
  const weekStart = getWeekStart();
  const weekAgo   = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const tasksCompleted = await query(`
    SELECT COUNT(*) as count FROM audit_tasks
    WHERE status = 'done' AND updated_at > $1
  `, [weekAgo]);

  const prsMerged = await query(`
    SELECT COUNT(*) as count FROM sprint_tasks
    WHERE status = 'done' AND completed_at > $1
  `, [weekAgo]);

  const buildsFixed = await query(`
    SELECT COUNT(*) as count FROM debug_attempts
    WHERE status = 'resolved' AND updated_at > $1
  `, [weekAgo]);

  const metrics   = await getAllLatestMetrics();
  const avgHealth = metrics.length > 0
    ? metrics.reduce((s: number, m: any) => s + parseFloat(m.health_score || 5), 0) / metrics.length
    : 5.0;

  const trend      = await getVelocityTrend(1);
  const lastHealth = trend.length > 0 ? parseFloat(trend[0].avg_health || 5) : 5;
  const healthDelta = avgHealth - lastHealth;

  const apiCost = await getMonthlyCost();

  await recordVelocity({
    weekStart,
    tasksCompleted: parseInt(tasksCompleted.rows[0]?.count || 0),
    prsMerged:      parseInt(prsMerged.rows[0]?.count || 0),
    buildsFixed:    parseInt(buildsFixed.rows[0]?.count || 0),
    avgHealth:      parseFloat(avgHealth.toFixed(1)),
    healthDelta:    parseFloat(healthDelta.toFixed(1)),
    apiCost,
    activeRepos:    metrics.filter((m: any) => m.build_status !== 'unknown').length,
  });

  logger.info({ weekStart, avgHealth: avgHealth.toFixed(1) }, 'Weekly velocity recorded');
}

async function getVelocityReport(): Promise<string> {
  const trend = await getVelocityTrend(4);

  if (trend.length === 0) {
    return 'No velocity data yet — check back after the first sprint completes.';
  }

  const latest   = trend[trend.length - 1];
  const arrow    = latest.health_delta > 0 ? '↑' : latest.health_delta < 0 ? '↓' : '→';
  const avg4w    = trend.reduce((s: number, t: any) => s + (t.tasks_completed || 0), 0) / trend.length;

  const lines = trend.map((t: any) =>
    `  w/o ${t.week_start}: ${t.tasks_completed} tasks · ${t.prs_merged} PRs · health ${t.avg_health}/10`
  ).join('\n');

  return [
    `📈 Velocity Report (last ${trend.length} weeks)`,
    ``,
    lines,
    ``,
    `Latest: health ${latest.avg_health}/10 ${arrow} (${latest.health_delta > 0 ? '+' : ''}${latest.health_delta})`,
    `4-week avg: ${avg4w.toFixed(1)} tasks/week`,
    `API cost this month: $${(latest.api_cost || 0).toFixed(2)}`,
  ].join('\n');
}

export = { recordWeeklyVelocity, getVelocityReport, getWeekStart };
