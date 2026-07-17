import { Client } from '@notionhq/client';
import logger from './logger';
import { getPortfolioSummary } from './portfolioAnalytics';
import { getDailyCost, getMonthlyCost, getOpenPatterns } from './portfolioDb';
import { getLatestMetrics } from './businessDb';
import { getLatestSecurityScore } from './securityDb';

const notion  = (): any => new Client({ auth: process.env['NOTION_API_KEY'] });
const PAGE_ID = (): string | undefined => process.env['NOTION_DASHBOARD_PAGE_ID'];

const STATUS_EMOJI: Record<string, string>   = { passing: '✅', failed: '❌', unknown: '⚪', building: '🔄' };
const PRIORITY_LABEL: Record<string, string> = {
  critical: '🔴 Critical', high: '🟠 High',
  medium:   '🟡 Medium',   low:  '🟢 Low',
};

async function updateDashboard(): Promise<void> {
  if (!PAGE_ID()) {
    logger.debug('NOTION_DASHBOARD_PAGE_ID not set — skipping dashboard update');
    return;
  }

  try {
    const [summary, patterns, dailyCost, monthlyCost, businessBlocks] = await Promise.all([
      getPortfolioSummary(),
      getOpenPatterns(),
      getDailyCost(),
      getMonthlyCost(),
      buildBusinessSection(),
    ]);

    const { metrics, avgHealth, healthy, broken } = summary;

    const now = new Date().toLocaleString('en-CA', {
      timeZone: 'America/Toronto',
      dateStyle: 'medium', timeStyle: 'short',
    });

    const sorted = [...metrics].sort((a: any, b: any) => {
      const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      return (order[a.priority] || 2) - (order[b.priority] || 2);
    });

    const secScoreMap: Record<string, any> = {};
    await Promise.allSettled(
      sorted.map(async (m: any) => {
        const s = await getLatestSecurityScore(m.repo_name).catch(() => null);
        if (s) secScoreMap[m.repo_name] = s.score;
      })
    );

    const blocks = [
      heading2(`🛡️ Sentinel Command Center — Updated ${now}`),
      divider(),
      heading3('📊 Portfolio Overview'),
      callout([
        `Health Score: ${avgHealth}/10`,
        `🟢 Healthy: ${healthy.length}  🔴 Broken: ${broken.length}  ⚪ Unknown: ${metrics.length - healthy.length - broken.length}`,
        `💰 API Spend: $${dailyCost.toFixed(2)} today · $${monthlyCost.toFixed(2)} this month`,
      ].join('\n'), '📊'),
      divider(),
      heading3('🗂️ Repo Status'),
      ...sorted.map((m: any) => {
        const status  = STATUS_EMOJI[m.build_status] || '⚪';
        const pri    = PRIORITY_LABEL[m.priority]   || '⚪ Unknown';
        const tasks  = m.tasks_queued > 0 ? ` · ${m.tasks_queued} queued` : '';
        const fails  = m.builds_failed > 0
          ? ` · ⚠️ ${m.builds_failed} build fail(s) today` : '';
        const health   = `Health: ${m.health_score}/10`;
        const secScore = secScoreMap[m.repo_name] != null
          ? `  🔒 Security: ${secScoreMap[m.repo_name]}/10` : '';
        return bulletText(`${status} ${m.repo_name} — ${pri}  ${health}${secScore}${fails}${tasks}`);
      }),
      divider(),
      heading3('🔍 Cross-Repo Patterns'),
      patterns.length > 0
        ? callout(patterns.slice(0, 5).map((p: any) =>
            `· ${p.description} — affects ${(p.affected_repos || []).join(', ')}`
          ).join('\n'), '🔍')
        : bulletText('✅ No patterns detected'),
      divider(),
      heading3('💼 Business Metrics'),
      ...businessBlocks,
      divider(),
      heading3('📋 Quick Commands'),
      code(
        '/sentinel execute <repo>  — run pending tasks\n' +
        '/sentinel audit <repo>    — trigger audit\n' +
        '/sentinel status <repo>   — repo details\n' +
        '/sentinel report          — get daily report now\n' +
        '/sentinel costs           — show API spend breakdown\n' +
        '/sentinel business <repo> — business metrics\n' +
        '/sentinel weekly          — weekly combined report'
      ),
    ];

    const existing = await notion().blocks.children.list({ block_id: PAGE_ID() });
    for (const block of existing.results) {
      try {
        await notion().blocks.delete({ block_id: block.id });
      } catch (e) { /* skip already-deleted */ }
    }

    for (let i = 0; i < blocks.length; i += 10) {
      await notion().blocks.children.append({
        block_id: PAGE_ID(),
        children: blocks.slice(i, i + 10),
      });
    }

    logger.info('Notion dashboard updated');

  } catch (err: any) {
    logger.error({ err: err.stack ?? err.message }, 'Dashboard update failed — non-blocking');
  }
}

const REVENUE_REPOS: string[] = ['tapcash', 'acc', 'costpilot'];

async function buildBusinessSection(): Promise<any[]> {
  try {
    const blocks: any[] = [];

    for (const repoName of REVENUE_REPOS) {
      const metrics = await getLatestMetrics(repoName).catch(() => []);
      if (metrics.length === 0) continue;

      const lines = metrics.map((m: any) => {
        const val = m.metric_unit === 'usd'
          ? `$${parseFloat(m.metric_value).toFixed(2)}`
          : parseFloat(m.metric_value).toLocaleString();
        return `${m.metric_name.replace(/_/g, ' ')}: ${val}`;
      }).join('\n');

      blocks.push(callout(`${repoName}\n${lines}`, '💼'));
    }

    return blocks.length > 0 ? blocks : [bulletText('No business metrics connected yet')];
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Business section build failed');
    return [bulletText('Business metrics unavailable')];
  }
}

function heading2(text: string): any {
  return { object: 'block', type: 'heading_2',
    heading_2: { rich_text: [{ type: 'text', text: { content: text } }] } };
}
function heading3(text: string): any {
  return { object: 'block', type: 'heading_3',
    heading_3: { rich_text: [{ type: 'text', text: { content: text } }] } };
}
function divider(): any {
  return { object: 'block', type: 'divider', divider: {} };
}
function callout(text: string, emoji = '💡'): any {
  return { object: 'block', type: 'callout', callout: {
    rich_text: [{ type: 'text', text: { content: text.substring(0, 2000) } }],
    icon: { emoji },
  }};
}
function bulletText(text: string): any {
  return { object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [{ type: 'text', text: { content: text.substring(0, 2000) } }],
    }};
}
function code(text: string): any {
  return { object: 'block', type: 'code',
    code: { rich_text: [{ type: 'text', text: { content: text } }], language: 'plain text' } };
}

export = { updateDashboard };

