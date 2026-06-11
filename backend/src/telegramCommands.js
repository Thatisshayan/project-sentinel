const logger = require('./logger');
const { sendTelegramMessage }         = require('./telegramClient');
const { findNotionProject }           = require('./notionClient');
const { stopDebugAttempts,
        getDebugAttempt }             = require('./dbClient');
const { checkAllProviders }           = require('./buildPoller');
const { orchestrateDebug }            = require('./debugOrchestrator');

async function handleCommand(text, chatId, topicId) {
  const parts   = text.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase();
  const project = parts[1];

  if (command !== '/sentinel' || !parts[1]) return false;

  const subcommand = parts[1].toLowerCase();

  switch (subcommand) {
    case 'stop':
      return handleStop(parts[2], topicId);
    case 'status':
      return handleStatus(parts[2], topicId);
    case 'builds':
      return handleBuilds(parts[2], topicId);
    case 'retry':
      return handleRetry(parts[2], topicId);
    case 'help':
      return handleHelp(topicId);
    default:
      return false;
  }
}

async function handleStop(projectArg, topicId) {
  if (!projectArg) {
    await sendTelegramMessage('Usage: /sentinel stop <repo-name>', topicId);
    return true;
  }

  try {
    await stopDebugAttempts(projectArg);
    await sendTelegramMessage(
      `✅ Debug attempts stopped for: ${projectArg}\nNo further automatic fixes will run.`,
      topicId
    );
  } catch (err) {
    await sendTelegramMessage(`❌ Error stopping: ${err.message}`, topicId);
  }
  return true;
}

async function handleStatus(projectArg, topicId) {
  if (!projectArg) {
    await sendTelegramMessage('Usage: /sentinel status <repo-name>', topicId);
    return true;
  }

  try {
    const project = await findNotionProject(projectArg);
    if (!project) {
      await sendTelegramMessage(`No Notion project found for: ${projectArg}`, topicId);
      return true;
    }

    await sendTelegramMessage(
      `Project: ${project.projectName}\nNotion: ${project.url}`,
      topicId
    );
  } catch (err) {
    await sendTelegramMessage(`❌ Error: ${err.message}`, topicId);
  }
  return true;
}

async function handleBuilds(projectArg, topicId) {
  if (!projectArg) {
    await sendTelegramMessage('Usage: /sentinel builds <repo-name>', topicId);
    return true;
  }

  try {
    // Need to find the full repo name — look up from Notion
    const project = await findNotionProject(projectArg);
    if (!project) {
      await sendTelegramMessage(`No project found for: ${projectArg}`, topicId);
      return true;
    }

    // Use the repo name to find latest commit SHA from Notion
    await sendTelegramMessage(
      `Checking builds for ${projectArg}...\n\nNote: Provide a commit SHA for detailed status.\nCheck GitHub Actions / Vercel / Railway directly for latest build.`,
      topicId
    );
  } catch (err) {
    await sendTelegramMessage(`❌ Error: ${err.message}`, topicId);
  }
  return true;
}

async function handleRetry(projectArg, topicId) {
  if (!projectArg) {
    await sendTelegramMessage('Usage: /sentinel retry <repo-name>', topicId);
    return true;
  }

  await sendTelegramMessage(
    `Manual retry for ${projectArg} is noted.\nPush a new commit to trigger the full loop, or check the latest build manually.`,
    topicId
  );
  return true;
}

async function handleHelp(topicId) {
  await sendTelegramMessage(
    [
      `Project Sentinel — Commands`,
      ``,
      `/sentinel stop <repo>    — stop auto-debug for a repo`,
      `/sentinel status <repo>  — show project status from Notion`,
      `/sentinel builds <repo>  — check latest build status`,
      `/sentinel retry <repo>   — manual retry note`,
      `/sentinel help           — show this message`,
    ].join('\n'),
    topicId
  );
  return true;
}

module.exports = { handleCommand };