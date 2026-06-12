const { Client } = require('@notionhq/client');
const logger     = require('./logger');
const { getPortfolioSummary }              = require('./portfolioAnalytics');
const { getDailyCost, getMonthlyCost,
        getOpenPatterns }                  = require('./portfolioDb');

const notion  = () => new Client({ auth: process.env.NOTION_API_KEY });
const PAGE_ID = () => process.env.NOTION_DASHBOARD_PAGE_ID;

const STATUS_EMOJI   = { passing: '✅', failed: '❌', unknown: '⚪', building: '🔄' };
const PRIORITY_LABEL = {
  critical: '🔴 Critical', high: '🟠 High',
  medium:   '🟡 Medium',   low:  '🟢 Low',
};

async function updateDashboard() {
  if (!PAGE_ID()) {
    logger.debug('NOTION_DASHBOARD_PAGE_ID not set — skipping dashboard update');
    return;
  }

  try {
    const [summary, patterns, dailyCost, monthlyCost] = await Promise.all([
      getPortfolioSummary(),
      getOpenPatterns(),
      getDailyCost(),
      getMonthlyCost(),
    ]);

    const { metrics, avgHealth, healthy, broken } = summary;

    const now = new Date().toLocaleString('en-CA', {
      timeZone: 'America/Toronto',
      dateStyle: 'medium', timeStyle: 'short',
    });

    const sorted = [...metrics].sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      return (order[a.priority] || 2) - (order[b.priority] || 2);
    });

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
      ...sorted.map(m => {
        const status = STATUS_EMOJI[m.build_status] || '⚪';
        const pri    = PRIORITY_LABEL[m.priority]   || '⚪ Unknown';
        const tasks  = m.tasks_queued > 0 ? ` · ${m.tasks_queued} queued` : '';
        const fails  = m.builds_failed > 0
          ? ` · ⚠️ ${m.builds_failed} build fail(s) today` : '';
        const score  = `Health: ${m.health_score}/10`;
        return bulletText(`${status} ${m.repo_name} — ${pri}  ${score}${fails}${tasks}`);
      }),
      divider(),
      heading3('🔍 Cross-Repo Patterns'),
      patterns.length > 0
        ? callout(patterns.slice(0, 5).map(p =>
            `· ${p.description} — affects ${(p.affected_repos || []).join(', ')}`
          ).join('\n'), '🔍')
        : bulletText('✅ No patterns detected'),
      divider(),
      heading3('📋 Quick Commands'),
      code(
        '/sentinel execute <repo>  — run pending tasks\n' +
        '/sentinel audit <repo>    — trigger audit\n' +
        '/sentinel status <repo>   — repo details\n' +
        '/sentinel report          — get daily report now\n' +
        '/sentinel costs           — show API spend breakdown'
      ),
    ];

    // Delete existing blocks
    const existing = await notion().blocks.children.list({ block_id: PAGE_ID() });
    for (const block of existing.results) {
      try {
        await notion().blocks.delete({ block_id: block.id });
      } catch (e) { /* skip already-deleted */ }
    }

    // Write new content in chunks of 10 (Notion API limit)
    for (let i = 0; i < blocks.length; i += 10) {
      await notion().blocks.children.append({
        block_id: PAGE_ID(),
        children: blocks.slice(i, i + 10),
      });
    }

    logger.info('Notion dashboard updated');

  } catch (err) {
    logger.error({ err: err.message }, 'Dashboard update failed — non-blocking');
  }
}

// ── Block builders ────────────────────────────────────────────────────────────

function heading2(text) {
  return { object: 'block', type: 'heading_2',
    heading_2: { rich_text: [{ type: 'text', text: { content: text } }] } };
}
function heading3(text) {
  return { object: 'block', type: 'heading_3',
    heading_3: { rich_text: [{ type: 'text', text: { content: text } }] } };
}
function divider() {
  return { object: 'block', type: 'divider', divider: {} };
}
function callout(text, emoji = '💡') {
  return { object: 'block', type: 'callout', callout: {
    rich_text: [{ type: 'text', text: { content: text.substring(0, 2000) } }],
    icon: { emoji },
  }};
}
function bulletText(text) {
  return { object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [{ type: 'text', text: { content: text.substring(0, 2000) } }],
    }};
}
function code(text) {
  return { object: 'block', type: 'code',
    code: { rich_text: [{ type: 'text', text: { content: text } }], language: 'plain text' } };
}

module.exports = { updateDashboard };
