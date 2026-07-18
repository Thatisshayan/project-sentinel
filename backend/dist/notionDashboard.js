"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const client_1 = require("@notionhq/client");
const logger_1 = __importDefault(require("./logger"));
const portfolioAnalytics_1 = require("./portfolioAnalytics");
const portfolioDb_1 = require("./portfolioDb");
const businessDb_1 = require("./businessDb");
const securityDb_1 = require("./securityDb");
const notion = () => new client_1.Client({ auth: process.env['NOTION_API_KEY'] });
const PAGE_ID = () => process.env['NOTION_DASHBOARD_PAGE_ID'];
const STATUS_EMOJI = { passing: '✅', failed: '❌', unknown: '⚪', building: '🔄' };
const PRIORITY_LABEL = {
    critical: '🔴 Critical', high: '🟠 High',
    medium: '🟡 Medium', low: '🟢 Low',
};
async function updateDashboard() {
    if (!PAGE_ID()) {
        logger_1.default.debug('NOTION_DASHBOARD_PAGE_ID not set — skipping dashboard update');
        return;
    }
    try {
        const [summary, patterns, dailyCost, monthlyCost, businessBlocks] = await Promise.all([
            (0, portfolioAnalytics_1.getPortfolioSummary)(),
            (0, portfolioDb_1.getOpenPatterns)(),
            (0, portfolioDb_1.getDailyCost)(),
            (0, portfolioDb_1.getMonthlyCost)(),
            buildBusinessSection(),
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
        const secScoreMap = {};
        await Promise.allSettled(sorted.map(async (m) => {
            const s = await (0, securityDb_1.getLatestSecurityScore)(m.repo_name).catch(() => null);
            if (s)
                secScoreMap[m.repo_name] = s.score;
        }));
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
            ...sorted.map((m) => {
                const status = STATUS_EMOJI[m.build_status] || '⚪';
                const pri = PRIORITY_LABEL[m.priority] || '⚪ Unknown';
                const tasks = m.tasks_queued > 0 ? ` · ${m.tasks_queued} queued` : '';
                const fails = m.builds_failed > 0
                    ? ` · ⚠️ ${m.builds_failed} build fail(s) today` : '';
                const health = `Health: ${m.health_score}/10`;
                const secScore = secScoreMap[m.repo_name] != null
                    ? `  🔒 Security: ${secScoreMap[m.repo_name]}/10` : '';
                return bulletText(`${status} ${m.repo_name} — ${pri}  ${health}${secScore}${fails}${tasks}`);
            }),
            divider(),
            heading3('🔍 Cross-Repo Patterns'),
            patterns.length > 0
                ? callout(patterns.slice(0, 5).map((p) => `· ${p.description} — affects ${(p.affected_repos || []).join(', ')}`).join('\n'), '🔍')
                : bulletText('✅ No patterns detected'),
            divider(),
            heading3('💼 Business Metrics'),
            ...businessBlocks,
            divider(),
            heading3('📋 Quick Commands'),
            code('/sentinel execute <repo>  — run pending tasks\n' +
                '/sentinel audit <repo>    — trigger audit\n' +
                '/sentinel status <repo>   — repo details\n' +
                '/sentinel report          — get daily report now\n' +
                '/sentinel costs           — show API spend breakdown\n' +
                '/sentinel business <repo> — business metrics\n' +
                '/sentinel weekly          — weekly combined report'),
        ];
        const existing = await notion().blocks.children.list({ block_id: PAGE_ID() });
        for (const block of existing.results) {
            try {
                await notion().blocks.delete({ block_id: block.id });
            }
            catch (e) { /* skip already-deleted */ }
        }
        for (let i = 0; i < blocks.length; i += 10) {
            await notion().blocks.children.append({
                block_id: PAGE_ID(),
                children: blocks.slice(i, i + 10),
            });
        }
        logger_1.default.info('Notion dashboard updated');
    }
    catch (err) {
        logger_1.default.error({ err: err.stack ?? err.message }, 'Dashboard update failed — non-blocking');
    }
}
const REVENUE_REPOS = ['tapcash', 'acc', 'costpilot'];
async function buildBusinessSection() {
    try {
        const blocks = [];
        for (const repoName of REVENUE_REPOS) {
            const metrics = await (0, businessDb_1.getLatestMetrics)(repoName).catch(() => []);
            if (metrics.length === 0)
                continue;
            const lines = metrics.map((m) => {
                const val = m.metric_unit === 'usd'
                    ? `$${parseFloat(m.metric_value).toFixed(2)}`
                    : parseFloat(m.metric_value).toLocaleString();
                return `${m.metric_name.replace(/_/g, ' ')}: ${val}`;
            }).join('\n');
            blocks.push(callout(`${repoName}\n${lines}`, '💼'));
        }
        return blocks.length > 0 ? blocks : [bulletText('No business metrics connected yet')];
    }
    catch (err) {
        logger_1.default.warn({ err: err.message }, 'Business section build failed');
        return [bulletText('Business metrics unavailable')];
    }
}
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
        } };
}
function bulletText(text) {
    return { object: 'block', type: 'bulleted_list_item',
        bulleted_list_item: {
            rich_text: [{ type: 'text', text: { content: text.substring(0, 2000) } }],
        } };
}
function code(text) {
    return { object: 'block', type: 'code',
        code: { rich_text: [{ type: 'text', text: { content: text } }], language: 'plain text' } };
}
module.exports = { updateDashboard };
//# sourceMappingURL=notionDashboard.js.map