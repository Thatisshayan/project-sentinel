import { Client } from '@notionhq/client';
import logger from './logger';
import { getLatestMetrics } from './businessDb';
import { getLatestSecurityScore } from './securityDb';
import { buildBoardroomSnapshot } from './boardroomSnapshot';

interface NotionBlock {
  object: 'block';
  type: string;
  [key: string]: unknown;
}

const notion  = (): Client => new Client({ auth: process.env['NOTION_API_KEY'] });
const PAGE_ID = (): string | undefined => process.env['NOTION_DASHBOARD_PAGE_ID'];

const STATUS_EMOJI: Record<string, string>   = { passing: '✅', failed: '❌', unknown: '⚪', building: '🔄' };
const PRIORITY_LABEL: Record<string, string> = {
  critical: '🔴 Critical', high: '🟠 High',
  medium: '🟡 Medium', low: '🟢 Low',
};

async function updateDashboard(): Promise<void> {
  const pageId = PAGE_ID();
  if (!pageId) {
    logger.debug('NOTION_DASHBOARD_PAGE_ID not set — skipping dashboard update');
    return;
  }

  try {
    const snapshot = await buildBoardroomSnapshot();
    const [businessBlocks] = await Promise.all([buildBusinessSection()]);
    const now = new Date().toLocaleString('en-CA', {
      timeZone: 'America/Toronto',
      dateStyle: 'medium', timeStyle: 'short',
    });

    const blocks = [
      heading2(`🛡️ Sentinel Command Center — Updated ${now}`),
      divider(),
      heading3('📊 Portfolio Overview'),
      callout([
        `Decision: ${snapshot.boardDecision}`,
        `Health Score: ${snapshot.health}/10`,
        `🟢 Active agents: ${snapshot.state.agentsActive}`,
        `📥 Queued tasks: ${snapshot.state.queueDepth}`,
      ].join('\n'), '📊'),
      divider(),
      heading3('🗂️ Repo Status'),
      ...snapshot.projects.map((m) => {
        const status  = STATUS_EMOJI['passing'] || '⚪';
        const pri    = PRIORITY_LABEL[m.tone === 'bad' ? 'high' : m.tone === 'warn' ? 'medium' : 'low'] || '⚪ Unknown';
        return bulletText(`${status} ${m.name} — ${pri}  Health: ${snapshot.health}/10`);
      }),
      divider(),
      heading3('🔍 Boardroom Risks'),
      ...snapshot.risks.map(([id, title, severity]) => bulletText(`${id} ${title} (${severity})`)),
      divider(),
      heading3('💼 Business Metrics'),
      ...businessBlocks,
      divider(),
      heading3('📋 Quick Commands'),
      code(
        '/sentinel dashboard      — refresh the shared snapshot\n' +
        '/sentinel report         — get daily report now\n' +
        '/sentinel costs          — show API spend breakdown\n' +
        '/sentinel business <repo> — business metrics\n' +
        '/sentinel weekly         — weekly combined report'
      ),
    ];

    const existing = await notion().blocks.children.list({ block_id: pageId });
    for (const block of existing.results) {
      try {
        await notion().blocks.delete({ block_id: block.id });
      } catch {
        /* skip already-deleted */
      }
    }

    for (let i = 0; i < blocks.length; i += 10) {
      await notion().blocks.children.append({
        block_id: pageId,
        children: blocks.slice(i, i + 10) as Parameters<Client['blocks']['children']['append']>[0]['children'],
      });
    }

    logger.info('Notion dashboard updated');
  } catch (err: any) {
    logger.error({ err: err.stack ?? err.message }, 'Dashboard update failed — non-blocking');
  }
}

const REVENUE_REPOS: string[] = ['tapcash', 'acc', 'costpilot'];

async function buildBusinessSection(): Promise<NotionBlock[]> {
  try {
    const blocks: NotionBlock[] = [];
    for (const repoName of REVENUE_REPOS) {
      const metrics = await getLatestMetrics(repoName).catch(() => []);
      if (metrics.length === 0) continue;
      const lines = metrics.map((m) => {
        if (m.metric_value == null) return `${m.metric_name.replace(/_/g, ' ')}: N/A`;
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

function heading2(text: string): NotionBlock { return { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: text } }] } }; }
function heading3(text: string): NotionBlock { return { object: 'block', type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: text } }] } }; }
function divider(): NotionBlock { return { object: 'block', type: 'divider', divider: {} }; }
function callout(text: string, emoji = '💡'): NotionBlock { return { object: 'block', type: 'callout', callout: { rich_text: [{ type: 'text', text: { content: text.substring(0, 2000) } }], icon: { emoji } } }; }
function bulletText(text: string): NotionBlock { return { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: text.substring(0, 2000) } }] } }; }
function code(text: string): NotionBlock { return { object: 'block', type: 'code', code: { rich_text: [{ type: 'text', text: { content: text } }], language: 'plain text' } }; }

export = { updateDashboard };
