const logger              = require('../logger');
const { sendTelegramMessage } = require('../telegramClient');
const { getAllAgents }    = require('../agentDb');

async function handleReportsCmd(subcommand, parts, chatId, topicId) {
  switch (subcommand) {
    case 'report': {
      const { sendDailyReport } = require('../dailyReport');
      await sendDailyReport();
      return true;
    }
    case 'costs': {
      const { getCostReport } = require('../costTracker');
      const report = await getCostReport();
      await sendTelegramMessage(report.formatted, null, topicId);
      return true;
    }
    case 'patterns': {
      const { getOpenPatterns } = require('../portfolioDb');
      const patterns = await getOpenPatterns();
      if (patterns.length === 0) {
        await sendTelegramMessage('No cross-repo patterns detected.', null, topicId);
      } else {
        const lines = patterns.map(p =>
          `· ${p.description}\n  Repos: ${(p.affected_repos || []).join(', ')}`
        ).join('\n\n');
        await sendTelegramMessage(`Cross-Repo Patterns:\n\n${lines}`, null, topicId);
      }
      return true;
    }
    case 'dashboard': {
      const { updateDashboard }    = require('../notionDashboard');
      const { getAllLatestMetrics } = require('../portfolioDb');
      const { getCapacityStatus }  = require('../capacityManager');
      const { getMonthlyCost, getDailyCost } = require('../portfolioDb');
      const { query: dbq }         = require('../dbClient');

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
        ? (metrics.reduce((s, m) => s + parseFloat(m.health_score || 5), 0) / metrics.length).toFixed(1)
        : 'N/A';
      const brokenRepos = metrics.filter(m => m.build_status === 'failed').map(m => m.repo_name);
      const working     = activeAgents.filter(a => a.status === 'working');

      const card = [
        `Project Sentinel — Live Dashboard`,
        ``,
        `Portfolio Health: ${avgHealth}/10 (${metrics.length} repos)`,
        brokenRepos.length ? `Broken: ${brokenRepos.join(', ')}` : `All builds passing`,
        ``,
        `Queued tasks (safe): ${queuedCount.rows[0]?.c || 0}`,
        `Agents working now: ${working.length}/${activeAgents.length}`,
        working.length
          ? working.map(a => `  · ${a.agent_id}: ${(a.repo_full_name || '').split('/')[1] || '?'} — ${a.task_title || '?'}`).join('\n')
          : '',
        ``,
        `Today's API spend: $${parseFloat(dailyCost).toFixed(3)}`,
        `Month: $${parseFloat(monthlyCost).toFixed(2)} / $${capacity.monthlyBudget || 30} (${capacity.usagePercent || 0}%)`,
        `Recommended builder: ${capacity.recommendedBuilder || 'nvidia'}`,
        ``,
        `Notion updated.`,
      ].filter(l => l !== null).join('\n');

      updateDashboard().catch(() => {});
      await sendTelegramMessage(card, null, topicId);
      return true;
    }
    case 'velocity': {
      const { getVelocityReport } = require('../velocityTracker');
      const report = await getVelocityReport();
      await sendTelegramMessage(report, null, topicId);
      return true;
    }
    case 'performance': {
      const { getPerformanceReport } = require('../performanceTracker');
      const report = await getPerformanceReport();
      await sendTelegramMessage(report, null, topicId);
      return true;
    }
    case 'prompts': {
      const { getPromptReport } = require('../promptOptimizer');
      const report = await getPromptReport();
      await sendTelegramMessage(report, null, topicId);
      return true;
    }
    case 'business': {
      const { generateWeeklyReport }   = require('../weeklyBusinessReport');
      const { getRepoBusinessSummary } = require('../businessMetrics');
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
      const { scoreAllQueuedTasks } = require('../roiScorer');
      await scoreAllQueuedTasks();
      await sendTelegramMessage('ROI scores updated for all queued tasks.', null, topicId);
      return true;
    }
    case 'impact': {
      if (!parts[2]) {
        await sendTelegramMessage('Usage: /sentinel impact <repo-name>', null, topicId);
        return true;
      }
      const { getCorrelationSummary } = require('../correlationEngine');
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
      const { generateWeeklyReport } = require('../weeklyBusinessReport');
      await generateWeeklyReport();
      return true;
    }
    case 'ceo': {
      const { generateCEOReport } = require('../ceoReport');
      await sendTelegramMessage('Generating CEO report...', null, topicId);
      generateCEOReport(topicId).catch(err => logger.error({ err: err.message }, 'Manual CEO report failed'));
      return true;
    }
    default:
      return false;
  }
}

module.exports = { handleReportsCmd };
