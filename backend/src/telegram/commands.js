import { config } from '../config.js';
import { queryDatabase, findProjectByRepo, updatePage } from '../notion/client.js';
import { sendMessage, buildReport } from '../telegram/reporter.js';
import { triggerDebugger } from '../debugger/orchestrator.js';
import { checkGitHubActions } from '../build/github-actions.js';
import { checkVercel } from '../build/vercel.js';
import { checkRailway } from '../build/railway-check.js';
import { generateSummary } from '../utils/summarize.js';

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
    '/sentinel_update': handleUpdate,
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
/sentinel update <project>  —  Refresh build status for a project
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

async function handleUpdate({ chatId, args }) {
  const projectName = args.join(' ');
  if (!projectName) {
    return sendMessage('Usage: /sentinel update <project>\nChecks and refreshes build status from GitHub/Vercel/Railway.', null);
  }

  try {
    const db = await queryDatabase();
    const results = db.results || [];
    const page = findProjectByRepo(results, projectName);

    if (!page) {
      return sendMessage(`Project "${projectName}" not found in Notion.`, null);
    }

    const p = page.properties;
    const repoName = p['Repo Name']?.rich_text?.[0]?.plain_text || '';
    const repoUrl = p['GitHub Repo URL']?.url || '';
    const commitHash = p['Last Commit Hash']?.rich_text?.[0]?.plain_text || '';
    const commitMessage = p['Last Commit Message']?.rich_text?.[0]?.plain_text || '';
    const author = p['Last Commit Author']?.rich_text?.[0]?.plain_text || '';
    const branch = p['Last Branch']?.rich_text?.[0]?.plain_text || 'main';
    const projectTitle = p['Project Name']?.title?.[0]?.plain_text || projectName;

    await sendMessage(`🔄 Checking build status for ${projectTitle}...`, null);

    if (!repoUrl || !commitHash) {
      return sendMessage(`No commit data for ${projectTitle}. Push a commit first.`, null);
    }

    const urlParts = repoUrl.replace('https://github.com/', '').split('/');
    const owner = urlParts[0] || 'Thatisshayan';
    const repo = urlParts[1] || repoName;

    const ghaResult = await checkGitHubActions(owner, repo, commitHash);
    const vercelResult = await checkVercel(null, commitHash);
    const railwayResult = await checkRailway(commitHash);

    const results_arr = [ghaResult, vercelResult, railwayResult].filter(r => r.status !== 'not_configured');
    const failed = results_arr.some(r => r.status === 'failed');
    const hasPending = results_arr.some(r => r.status === 'pending');
    const overallBuildStatus = failed ? 'failed' : hasPending ? 'pending' : results_arr.length > 0 ? 'success' : 'not_configured';
    const buildProvider = results_arr.map(r => r.provider).join(', ') || 'None';
    const buildUrl = results_arr.find(r => r.inspectUrl || r.deploymentUrl)?.inspectUrl || results_arr.find(r => r.deploymentUrl)?.deploymentUrl || '';

    const ciMap = { success: 'Passing', failed: 'Failing', pending: 'Unknown', not_configured: 'Unknown', unknown: 'Unknown' };
    const depMap = { success: 'Deployed', failed: 'Degraded', pending: 'Unknown', not_configured: 'Not deployed', unknown: 'Unknown' };

    await updatePage(page.id, {
      'CI Status': { select: { name: ciMap[overallBuildStatus] || 'Unknown' } },
      'Deployment Status': { select: { name: depMap[overallBuildStatus] || 'Unknown' } },
      'Build Provider': results_arr.length > 0 ? { select: { name: buildProvider } } : undefined,
      'Build URL': buildUrl ? { url: buildUrl } : undefined,
    });

    const summary = generateSummary(commitMessage, []);
    const report = buildReport({
      project: projectTitle, repo: repoName, branch, commitMessage,
      author, filesChanged: p['Files Changed Count']?.number || 0,
      risk: p['Risk Level']?.select?.name || '—',
      buildStatus: overallBuildStatus, buildProvider, buildUrl,
      notionUpdated: true, changelogAppended: false,
      debuggerTriggered: false, commitUrl: p['Last Commit URL']?.url || '',
      summary,
    });

    await sendMessage(report, null);
  } catch (err) {
    await sendMessage(`Error updating ${projectName}: ${err.message}`, null);
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
