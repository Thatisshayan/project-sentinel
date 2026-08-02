import { safeFire, fireAndForget } from '../utils/safeFire';
import logger from '../logger';
import { sendTelegramMessage } from '../telegramClient';
import { getAllAgents } from '../agentDb';
import type { PortfolioMetricRow, RepoPatternRow } from '../types/portfolioRow';
import type { CapacityStatus } from '../types/capacityStatus';

async function handleReportsCmd(subcommand: string, parts: string[], chatId: string | null, topicId: number | null): Promise<boolean> {
  switch (subcommand) {
    case 'report': {
      const { sendDailyReport } = require('../dailyReport') as { sendDailyReport: () => Promise<void> };
      await sendDailyReport();
      return true;
    }
    case 'costs': {
      const { getCostReport } = require('../costTracker') as { getCostReport: () => Promise<{ formatted: string }> };
      const report = await getCostReport();
      await sendTelegramMessage(report.formatted, null, topicId);
      return true;
    }
    case 'patterns': {
      const { getOpenPatterns } = require('../portfolioDb') as { getOpenPatterns: () => Promise<RepoPatternRow[]> };
      const patterns = await getOpenPatterns();
      if (patterns.length === 0) {
        await sendTelegramMessage('No cross-repo patterns detected.', null, topicId);
      } else {
        const lines = patterns.map((p) => `· ${p.description}\n  Repos: ${(p.affected_repos || []).join(', ')}`).join('\n\n');
        await sendTelegramMessage(`Cross-Repo Patterns:\n\n${lines}`, null, topicId);
      }
      return true;
    }
    case 'dashboard': {
      const { updateDashboard } = require('../notionDashboard') as { updateDashboard: () => Promise<void> };
      const { getAllLatestMetrics } = require('../portfolioDb') as { getAllLatestMetrics: () => Promise<PortfolioMetricRow[]> };
      const { getCapacityStatus } = require('../capacityManager') as { getCapacityStatus: () => Promise<CapacityStatus> };
      const { query: dbq } = require('../dbClient') as { query: (sql: string) => Promise<{ rows: { c: string }[] }> };

      const [metrics, capacity, activeAgents, queuedCount] = await Promise.all([
        getAllLatestMetrics().catch(() => [] as PortfolioMetricRow[]),
        getCapacityStatus().catch(() => ({} as Partial<CapacityStatus>)),
        getAllAgents().catch(() => []),
        dbq(`SELECT COUNT(*) as c FROM audit_tasks WHERE status = 'queued' AND safe_to_auto_execute = true`).catch(() => ({ rows: [{ c: '0' }] })),
      ]);

      const avgHealth = metrics.length
        ? (metrics.reduce((s: number, m: PortfolioMetricRow) => s + parseFloat(m.health_score || '5'), 0) / metrics.length).toFixed(1)
        : 'N/A';
      const brokenRepos = metrics.filter((m) => m.build_status === 'failed').map((m) => m.repo_name);
      const working = activeAgents.filter((a) => a.status === 'working');

      const card = [
        `Project Sentinel — dashboard refresh queued`,
        `Portfolio Health: ${avgHealth}/10 (${metrics.length} repos)`,
        brokenRepos.length ? `Broken: ${brokenRepos.join(', ')}` : `All builds passing`,
        `Queued tasks (safe): ${queuedCount.rows[0]?.c || 0}`,
        `Agents working now: ${working.length}/${activeAgents.length}`,
        `Recommended builder: ${capacity.recommendedBuilder || 'nvidia'}`,
      ].join('\n');

      fireAndForget(updateDashboard(), { label: 'reports' });
      await sendTelegramMessage(card, null, topicId);
      return true;
    }
    case 'velocity': {
      const { getVelocityReport } = require('../velocityTracker') as { getVelocityReport: () => Promise<string> };
      const report = await getVelocityReport();
      await sendTelegramMessage(report, null, topicId);
      return true;
    }
    case 'performance': {
      const { getPerformanceReport } = require('../performanceTracker') as { getPerformanceReport: () => Promise<string> };
      const report = await getPerformanceReport();
      await sendTelegramMessage(report, null, topicId);
      return true;
    }
    case 'prompts': {
      const { getPromptReport } = require('../promptOptimizer') as { getPromptReport: () => Promise<string> };
      const report = await getPromptReport();
      await sendTelegramMessage(report, null, topicId);
      return true;
    }
    case 'business': {
      const { generateWeeklyReport } = require('../weeklyBusinessReport') as { generateWeeklyReport: () => Promise<void> };
      const { getRepoBusinessSummary } = require('../businessMetrics') as { getRepoBusinessSummary: (repo: string) => Promise<string | null> };
      if (parts[2]) {
        const summary = await getRepoBusinessSummary(parts[2]);
        await sendTelegramMessage(summary || `No business metrics for ${parts[2]} yet.`, parts[2], topicId);
      } else {
        await generateWeeklyReport();
      }
      return true;
    }
    case 'roi': {
      const { scoreAllQueuedTasks } = require('../roiScorer') as { scoreAllQueuedTasks: () => Promise<void> };
      await scoreAllQueuedTasks();
      await sendTelegramMessage('ROI scores updated for all queued tasks.', null, topicId);
      return true;
    }
    case 'impact': {
      if (!parts[2]) {
        await sendTelegramMessage('Usage: /sentinel impact <repo-name>', null, topicId);
        return true;
      }
      const { getCorrelationSummary } = require('../correlationEngine') as {
        getCorrelationSummary: (repo: string) => Promise<{
          avg_impact: string | null; pr_count: string; positive_prs: string;
          best_impact: string | null; worst_impact: string | null;
        } | null>;
      };
      const corr = await getCorrelationSummary(parts[2]);
      if (!corr || !corr.pr_count || corr.pr_count === '0') {
        await sendTelegramMessage(`No PR impact data for ${parts[2]} yet.`, parts[2], topicId);
        return true;
      }
      await sendTelegramMessage([
        `📊 PR Impact — ${parts[2]} (last 30 days)`,
        `PRs analysed: ${corr.pr_count}`,
        `Avg impact score: ${parseFloat(corr.avg_impact || '0').toFixed(1)}`,
        `Positive PRs: ${corr.positive_prs}/${corr.pr_count}`,
        `Best PR score: ${parseFloat(corr.best_impact || '0').toFixed(1)}`,
        `Worst PR score: ${parseFloat(corr.worst_impact || '0').toFixed(1)}`,
      ].join('\n'), parts[2], topicId);
      return true;
    }
    case 'weekly': {
      const { generateWeeklyReport } = require('../weeklyBusinessReport') as { generateWeeklyReport: () => Promise<void> };
      await generateWeeklyReport();
      return true;
    }
    case 'ceo': {
      const { generateCEOReport } = require('../ceoReport') as { generateCEOReport: (topicId?: number | null) => Promise<void> };
      await sendTelegramMessage('Generating CEO report...', null, topicId);
      generateCEOReport(topicId).catch((err: any) => logger.error({ err: err.stack ?? err.message }, 'Manual CEO report failed'));
      return true;
    }
    default:
      return false;
  }
}

export = { handleReportsCmd };
