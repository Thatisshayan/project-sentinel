import logger from './logger';
import axios from 'axios';
import { sendTelegramMessage } from './telegramClient';
import { createChannelForRepo } from './slackClient';
import { triggerAudit } from './auditOrchestrator';
import { findNotionProject } from './notionClient';
import { repoFullName, getGithubOrg } from './repoResolver';

function getWatchedRepos(): string[] {
  return (process.env['WATCHED_REPOS'] || '').split(',').map((r: string) => r.trim()).filter(Boolean);
}

async function onboardRepo(repoName: string): Promise<void> {
  logger.info({ repoName }, 'New repo detected — onboarding');

  const notionClient = require('./notionClient') as any;
  let notionPageId: string | null = null;
  if (typeof notionClient.createNotionProject === 'function') {
    notionPageId = await notionClient.createNotionProject({
      repoName, priority: 'medium', builderAgent: 'qwen_coder',
    }).catch((err: any) => {
      logger.warn({ err: err.message, repoName }, 'Notion row creation failed');
      return null;
    });
  } else {
    logger.warn({ repoName }, 'createNotionProject not available — add repo row to Notion manually');
  }

  const webhookRegistered = await registerWebhook(repoName).then(() => true).catch((err: any) => {
    logger.warn({ err: err.message, repoName }, 'Webhook registration failed — register manually in GitHub');
    return false;
  });

  // Phase 1 of docs/2026-07-22-slack-agent-roster-plan.md — best-effort,
  // same pattern as Notion/webhook above: never blocks onboarding, reported
  // in the summary message either way. No-op (returns null) if Slack isn't
  // configured yet — see slackClient.ts.
  const slackChannelId = await createChannelForRepo(repoName).catch((err: any) => {
    logger.warn({ err: err.message, repoName }, 'Slack channel creation failed — create manually if needed');
    return null;
  });

  const auditTriggered = await triggerAudit({
    repoFullName:  repoFullName(repoName),
    repoName,
    projectName:   repoName,
    commitSha:     `onboard-${Date.now()}`,
    commitMessage: '[sentinel-onboard] Initial audit',
    branchName:    'main',
    authorName:    'Sentinel',
    authorEmail:   '',
    topicId:       null,
  }).then((result: any) => {
    if (!result.started) {
      logger.warn({ repoName, reason: result.reason }, 'First audit did not start');
    }
    return result.started;
  }).catch((err: any) => {
    logger.warn({ err: err.message, repoName }, 'First audit failed');
    return false;
  });

  await sendTelegramMessage([
    `🆕 New repo onboarded: ${repoName}`,
    `Notion row created ${notionPageId ? '✅' : '❌ — add manually'}`,
    `GitHub webhook registered ${webhookRegistered ? '✅' : '❌ — register manually'}`,
    `Slack channel ${slackChannelId ? '✅ #' + repoName.toLowerCase() : '❌ — create manually (Slack not configured yet)'}`,
    `First audit triggered ${auditTriggered ? '✅' : '❌ — see logs'}`,
    `Sentinel is now monitoring ${repoName}.`,
  ].join('\n'), null, null);

  logger.info({ repoName, notionPageId, webhookRegistered, slackChannelId, auditTriggered }, 'Repo onboarding complete');
}

async function checkAndOnboardNewRepos(): Promise<void> {
  const repos = getWatchedRepos();
  if (repos.length === 0) {
    logger.info('WATCHED_REPOS not configured — onboarding skipped');
    return;
  }

  for (const repoName of repos) {
    try {
      const existing = await findNotionProject(repoName).catch(() => null);
      if (existing) continue;
      await onboardRepo(repoName);
    } catch (err: any) {
      logger.error({ err: err.stack ?? err.message, repoName }, 'Repo onboarding failed');
    }
  }

  logger.info({ count: repos.length }, 'Repo onboarding check complete');
}

async function registerWebhook(repoName: string): Promise<void> {
  const domain     = process.env['RAILWAY_PUBLIC_DOMAIN'];
  if (!domain) { logger.warn({ repoName }, 'RAILWAY_PUBLIC_DOMAIN not set — skipping webhook registration'); return; }
  const webhookUrl = `https://${domain}/webhook/github`;

  await axios.post(
    `https://api.github.com/repos/${getGithubOrg()}/${repoName}/hooks`,
    {
      name:   'web',
      active: true,
      events: ['push', 'pull_request'],
      config: {
        url:          webhookUrl,
        content_type: 'json',
        secret:       process.env['GITHUB_WEBHOOK_SECRET'],
      },
    },
    {
      headers: {
        Authorization: `token ${process.env['GITHUB_TOKEN']}`,
        Accept:        'application/vnd.github.v3+json',
      },
    }
  );
}

export = { checkAndOnboardNewRepos, getWatchedRepos, onboardRepo, registerWebhook };

