import { safeFire, fireAndForget } from '../utils/safeFire';
import logger from '../logger';
import { sendTelegramMessage } from '../telegramClient';
import { getAllAgents } from '../agentDb';

async function handleReportsCmd(subcommand: string, parts: string[], chatId: string | null, topicId: number | null): Promise<boolean> {
  switch (subcommand) {
    case 'report': {
      const { sendDailyReport } = require('../dailyReport') as { sendDailyReport: () => Promise<void> };
      await sendDailyReport();
      return true;
    }
    case 'costs': {
      const { getCostReport } = require('../costTracker') as { getCostReport: () => Promise<any> };
      const report = await getCostReport();
      await sendTelegramMessage(report.formatted, null, topicId);
      return true;
    }
    case 'patterns': {
      const { getOpenPatterns } = require('../portfolioDb') as { getOpenPatterns: () => Promise<any[]> };
      const patterns = await getOpenPatterns();
      if (patterns.length === 0) {
        await sendTelegramMessage('No cross-repo patterns detected.', null, topicId);
      } else {
        const lines = patterns.map((p: any) =>
          `· ${p.description}\n  Repos: ${(p.affected_repos || []).join(', ')}`
        ).join('\n\n');
        await sendTelegramMessage(`Cross-Repo Patterns:\n\n${lines}`, null, topicId);
      }
      return true;
    }
    case 'dashboard': {
      const { updateDashboard }    = require('../notionDashboard') as { updateDashboard: () => Promise<void> };
      const { getAllLatestMetrics } = require('../portfolioDb') as { getAllLatestMetrics: () => Promise<any[]> };
      const { getCapacityStatus }  = require('../capacityManager') as { getCapacityStatus: () => Promise<any> };
      const { getMonthlyCost, getDailyCost } = require('../portfolioDb') as { getMonthlyCost: () => Promise<number>; getDailyCost: () => Promise<number> };
      const { query: dbq }         = require('../dbClient') as { query: (...args: any[]) => Promise<any> };

      const [metrics, capacity, dailyCost, monthlyCost, activeAgents, queuedCount] =
        await Promise.all([
          getAllLatestMetrics().catch(() => []),
          getCapacityStatus().catch(() => ({})),
          getDailyCost().catch(() => 0),
          getMonthlyCost().catch(() => 0),
          getAllAgents().catch(() => []),
          dbq(`SELECT COUNT(*) as c FROM audit_tasks WHERE status = 'queued' AND safe_to_auto_execute = true`).catch(() => ({ rows: [{ c: 0 }] })),
        ]);

      const avgHealth = metrics.length
        ? (metrics.reduce((s: number, m: any) => s + parseFloat(m.health_score || 5), 0) / metrics.length).toFixed(1)
        : 'N/A';
      const brokenRepos = metrics.filter((m: any) => m.build_status === 'failed').map((m: any) => m.repo_name);
      const working     = activeAgents.filter((a: any) => a.status === 'working');

      const card = [
        `Project Sentinel — Live Dashboard`,
        ``,
        `Portfolio Health: ${avgHealth}/10 (${metrics.length} repos)`,
        brokenRepos.length ? `Broken: ${brokenRepos.join(', ')}` : `All builds passing`,
        ``,
        `Queued tasks (safe): ${queuedCount.rows[0]?.c || 0}`,
        `Agents working now: ${working.length}/${activeAgents.length}`,
        working.length
          ? working.map((a: any) => `  · ${a.agent_id}: ${(a.repo_full_name || '').split('/')[1] || '?'} — ${a.task_title || '?'}`).join('\n')
          : '',
        ``,
        `Today's API spend: $${parseFloat(String(dailyCost)).toFixed(3)}`,
        `Month: $${parseFloat(String(monthlyCost)).toFixed(2)} / $${capacity.monthlyBudget || 30} (${capacity.usagePercent || 0}%)`,
        `Recommended builder: ${capacity.recommendedBuilder || 'nvidia'}`,
        ``,
        `Notion updated.`,
      ].filter((l: string | null) => l !== null).join('\n');

      fireAndForget(updateDashboard(), { label: 'reports' })
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
      const { generateWeeklyReport }   = require('../weeklyBusinessReport') as { generateWeeklyReport: () => Promise<void> };
      const { getRepoBusinessSummary } = require('../businessMetrics') as { getRepoBusinessSummary: (repo: string) => Promise<string | null> };
      if (parts[2]) {
        const summary = await getRepoBusinessSummary(parts[2]);
        await sendTelegramMessage(
          summary || `No business metrics for ${parts[2]} yet.`,
          null, topicId
        );
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
      const { getCorrelationSummary } = require('../correlationEngine') as { getCorrelationSummary: (repo: string) => Promise<any> };
      const corr = await getCorrelationSummary(parts[2]);
      if (!corr || !corr.pr_count) {
        await sendTelegramMessage(`No PR impact data for ${parts[2]} yet.`, null, topicId);
        return true;
      }
      await sendTelegramMessage([
        `📊 PR Impact — ${parts[2]} (last 30 days)`,
        `PRs analysed: ${corr.pr_count}`,
        `Avg impact score: ${parseFloat(corr.avg_impact).toFixed(1)}`,
        `Positive PRs: ${corr.positive_prs}/${corr.pr_count}`,
        `Best PR score: ${parseFloat(corr.best_impact).toFixed(1)}`,
        `Worst PR score: ${parseFloat(corr.worst_impact).toFixed(1)}`,
      ].join('\n'), null, topicId);
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

