import logger from './logger';
import axios from 'axios';
import { sendTelegramMessage } from './telegramClient';
import { triggerAudit } from './auditOrchestrator';
import { findNotionProject } from './notionClient';
import { repoFullName, getGithubOrg } from './repoResolver';

function getWatchedRepos(): string[] {
  return (process.env['WATCHED_REPOS'] || '').split(',').map((r: string) => r.trim()).filter(Boolean);
}

async function onboardRepo(repoName: string): Promise<void> {
  logger.info({ repoName }, 'New repo detected — onboarding');

  const notionClient = require('./notionClient') as any;
  if (typeof notionClient.createNotionProject === 'function') {
    await notionClient.createNotionProject({
      repoName, priority: 'medium', builderAgent: 'qwen_coder', healthScore: 0,
    }).catch((err: any) => logger.warn({ err: err.message, repoName }, 'Notion row creation failed'));
  } else {
    logger.warn({ repoName }, 'createNotionProject not available — add repo row to Notion manually');
  }

  await registerWebhook(repoName).catch((err: any) =>
    logger.warn({ err: err.message, repoName }, 'Webhook registration failed — register manually in GitHub')
  );

  await triggerAudit({
    repoFullName:  repoFullName(repoName),
    repoName,
    projectName:   repoName,
    commitSha:     `onboard-${Date.now()}`,
    commitMessage: '[sentinel-onboard] Initial audit',
    branchName:    'main',
    authorName:    'Sentinel',
    authorEmail:   '',
    topicId:       null,
  }).catch((err: any) => logger.warn({ err: err.message, repoName }, 'First audit failed'));

  await sendTelegramMessage([
    `🆕 New repo onboarded: ${repoName}`,
    `Notion row created ✅`,
    `GitHub webhook registered ✅`,
    `First audit triggered ✅`,
    `Sentinel is now monitoring ${repoName}.`,
  ].join('\n'), null, null);

  logger.info({ repoName }, 'Repo onboarding complete');
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

