import { config } from '../config.js';

const BASE = `https://api.telegram.org/bot${config.telegram.botToken}`;

export async function sendMessage(text, parseMode = 'HTML') {
  const url = `${BASE}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.telegram.chatId,
      text,
      parse_mode: parseMode,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('Telegram send failed:', err);
    return false;
  }
  return true;
}

export function buildReport({ project, repo, branch, commitMessage, author, filesChanged, risk, buildStatus, buildProvider, buildUrl, notionUpdated, changelogAppended, debuggerTriggered, retryAttempt, commitUrl }) {
  const statusIcon = buildStatus === 'failed' ? '❌' : buildStatus === 'success' ? '✅' : '⚠️';
  let text = `Project Sentinel update ${statusIcon}\n\n`;
  text += `Project: ${project}\n`;
  text += `Repo: ${repo}\n`;
  text += `Branch: ${branch}\n`;
  text += `Commit: ${commitMessage}\n`;
  text += `Author: ${author}\n`;
  text += `Files changed: ${filesChanged}\n`;
  text += `Risk: ${risk}\n\n`;
  text += `Build status: ${buildStatus}\n`;
  text += `Provider: ${buildProvider}\n`;
  if (buildUrl) text += `Build URL: ${buildUrl}\n\n`;
  text += `Notion updated: ${notionUpdated ? 'Yes' : 'No'}\n`;
  text += `Changelog appended: ${changelogAppended ? 'Yes' : 'No'}\n\n`;
  text += `Debugger triggered: ${debuggerTriggered ? 'Yes' : 'No'}\n`;
  if (retryAttempt) text += `Retry attempt: ${retryAttempt}\n`;
  text += `\nCommit URL: ${commitUrl}`;
  return text;
}

export function buildFailureReport({ project, repo, branch, commitMessage, buildProvider, buildUrl, failureReason, attempt }) {
  let text = `Project Sentinel build failed ❌\n\n`;
  text += `Project: ${project}\n`;
  text += `Repo: ${repo}\n`;
  text += `Branch: ${branch}\n`;
  text += `Commit: ${commitMessage}\n`;
  text += `Build provider: ${buildProvider}\n`;
  text += `Build URL: ${buildUrl}\n`;
  text += `Failure reason: ${failureReason}\n\n`;
  text += `Debugger will start.\n`;
  text += `Debugger order:\n1. OpenCode\n2. Kilo CLI\n3. Kiro\n\n`;
  text += `Retry attempt: ${attempt}/5`;
  return text;
}

export function buildDebuggerUpdate({ project, repo, debugger: debuggerName, attempt, fixCommitted, fixUrl }) {
  let text = `Project Sentinel debugger update 🛠️\n\n`;
  text += `Project: ${project}\n`;
  text += `Repo: ${repo}\n`;
  text += `Debugger: ${debuggerName}\n`;
  text += `Attempt: ${attempt}/5\n\n`;
  text += `Fix committed: ${fixCommitted ? 'Yes' : 'No'}\n`;
  if (fixUrl) text += `Fix commit: ${fixUrl}\n`;
  text += `Build will run again.`;
  return text;
}

export function buildExhaustedReport({ project, repo, branch, failedCommitUrl, attemptsUsed, lastDebugger, lastError }) {
  let text = `Project Sentinel needs human help 🚨\n\n`;
  text += `Project: ${project}\n`;
  text += `Repo: ${repo}\n`;
  text += `Branch: ${branch}\n`;
  text += `Original failed commit: ${failedCommitUrl}\n`;
  text += `Attempts used: ${attemptsUsed}/5\n`;
  text += `Last debugger: ${lastDebugger}\n`;
  text += `Last error: ${lastError}\n\n`;
  text += `Automatic repair stopped.\nHuman review required.`;
  return text;
}

export function buildUnknownRepoWarning({ repoName, branch, repoUrl, commitMessage }) {
  let text = `Project Sentinel warning ⚠️\n\n`;
  text += `Unknown repo received: ${repoName}\n`;
  text += `Branch: ${branch}\n`;
  text += `Repo URL: ${repoUrl}\n`;
  text += `Commit: ${commitMessage}\n\n`;
  text += `No matching Notion project was found.\nCheck the Repo Name field in Notion.`;
  return text;
}
