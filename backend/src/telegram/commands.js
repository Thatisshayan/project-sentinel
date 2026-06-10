import { config } from '../config.js';
import { queryDatabase, findProjectByRepo } from '../notion/client.js';
import { sendMessage } from '../telegram/reporter.js';
import { triggerDebugger } from '../debugger/orchestrator.js';

const BASE = `https://api.telegram.org/bot${config.telegram.botToken}`;

export async function handleTelegramUpdate(update) {
  const msg = update.message;
  if (!msg?.text) return;

  const chatId = msg.chat.id;
  const threadId = msg.message_thread_id;
  const text = msg.text.trim();
  const from = msg.from?.id;

  if (!text.startsWith('/sentinel')) return;

  const parts = text.split(/\s+/);
  const command = parts[0]?.toLowerCase();
  const args = parts.slice(1);

  const handler = {
    '/sentinel': handleHelp,
    '/sentinel@prosentinelbot': handleHelp,
    '/sentinel_help': handleHelp,
    '/sentinel_status': handleStatus,
    '/sentinel_repos': handleRepos,
    '/sentinel_fix': handleFix,
  }[command];

  if (handler) {
    await handler({ chatId, threadId, args, from });
  } else {
    await sendMessage(
      `Unknown command. Try /sentinel help`,
      null
    );
  }
}

async function handleHelp({ chatId }) {
  const help = `Project Sentinel commands:

/sentinel status <project>  —  Show project status from Notion
/sentinel repos             —  List all tracked repos
/sentinel fix <repo>        —  Trigger debugger for a repo
/sentinel help              —  Show this message`;
  await sendMessage(help, null);
}

async function handleStatus({ chatId, args }) {
  const projectName = args.join(' ');
  if (!projectName) {
    return sendMessage('Usage: /sentinel status <project>', null);
  }

  try {
    const db = await queryDatabase();
    const results = db.results || [];
    const page = findProjectByRepo(results, projectName);

    if (!page) {
      return sendMessage(`Project "${projectName}" not found in Notion.`, null);
    }

    const p = page.properties;
    const lines = [
      `📊 ${p['Project Name']?.title?.[0]?.plain_text || projectName}`,
      `Repo: ${p['Repo Name']?.rich_text?.[0]?.plain_text || '—'}`,
      `Status: ${p['Status']?.status?.name || '—'}`,
      `Last commit: ${(p['Last Commit Message']?.rich_text?.[0]?.plain_text || '—').slice(0, 60)}`,
      `Branch: ${p['Last Branch']?.rich_text?.[0]?.plain_text || '—'}`,
      `Author: ${p['Last Commit Author']?.rich_text?.[0]?.plain_text || '—'}`,
      `CI: ${p['CI Status']?.select?.name || '—'}`,
      `Deployment: ${p['Deployment Status']?.select?.name || '—'}`,
      `Risk: ${p['Risk Level']?.select?.name || '—'}`,
    ];
    if (p['Current Focus']?.rich_text?.[0]?.plain_text) {
      lines.push(`Focus: ${p['Current Focus'].rich_text[0].plain_text}`);
    }

    await sendMessage(lines.join('\n'), null);
  } catch (err) {
    await sendMessage(`Error fetching status: ${err.message}`, null);
  }
}

async function handleRepos({ chatId }) {
  try {
    const db = await queryDatabase();
    const results = db.results || [];

    const lines = results.map(p => {
      const name = p.properties?.['Project Name']?.title?.[0]?.plain_text || '?';
      const repo = p.properties?.['Repo Name']?.rich_text?.[0]?.plain_text || '—';
      const ci = p.properties?.['CI Status']?.select?.name || '—';
      return `• ${name} (${repo}) — CI: ${ci}`;
    });

    await sendMessage(`📋 Tracked repos (${lines.length}):\n\n${lines.join('\n')}`, null);
  } catch (err) {
    await sendMessage(`Error fetching repos: ${err.message}`, null);
  }
}

async function handleFix({ chatId, threadId, args }) {
  const repoName = args[0];
  if (!repoName) {
    return sendMessage('Usage: /sentinel fix <repo>', null);
  }

  try {
    const db = await queryDatabase();
    const results = db.results || [];
    const notionPage = findProjectByRepo(results, repoName);

    if (!notionPage) {
      return sendMessage(`Repo "${repoName}" not found in Notion.`, null);
    }

    const projectName = notionPage.properties?.['Project Name']?.title?.[0]?.plain_text || repoName;
    const lastCommitHash = notionPage.properties?.['Last Commit Hash']?.rich_text?.[0]?.plain_text || '';

    const event = {
      repoName,
      repoUrl: notionPage.properties?.['GitHub Repo URL']?.url || `https://github.com/Thatisshayan/${repoName}`,
      branchName: notionPage.properties?.['Last Branch']?.rich_text?.[0]?.plain_text || 'main',
      commitHash: lastCommitHash,
      commitMessage: notionPage.properties?.['Last Commit Message']?.rich_text?.[0]?.plain_text || '',
      authorName: notionPage.properties?.['Last Commit Author']?.rich_text?.[0]?.plain_text || '',
      changedFiles: [],
      changedFilesText: '',
      commitUrl: notionPage.properties?.['Last Commit URL']?.url || '',
    };

    await sendMessage(`🛠️ Triggering debugger for ${projectName}...`, null);

    const result = await triggerDebugger(event, notionPage, projectName, 'manual', '', 'Manual trigger via /sentinel fix');

    if (result.fixed) {
      await sendMessage(`✅ ${result.agent} fixed the build (attempt ${result.attempts}).\nFix: ${result.fixUrl}`, null);
    } else if (result.highRisk) {
      await sendMessage('⛔ Debugger stopped: high-risk changes detected. Human review required.', null);
    } else if (result.exhausted) {
      await sendMessage('🚨 5 retry attempts exhausted. Human review required.', null);
    } else {
      await sendMessage('❌ Debugger could not fix the build.', null);
    }
  } catch (err) {
    await sendMessage(`Error triggering debugger: ${err.message}`, null);
  }
}

export async function registerTelegramWebhook() {
  const url = `https://api.telegram.org/bot${config.telegram.botToken}/setWebhook`;
  const webhookUrl = `https://sentinel-backend-production-d225.up.railway.app/webhook/telegram`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl }),
  });
  const data = await res.json();
  if (data.ok) {
    console.log('Telegram webhook registered');
  } else {
    console.error('Telegram webhook registration failed:', data.description);
  }
}
