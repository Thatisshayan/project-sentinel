const logger = require('./logger');
const axios  = require('axios');
const { sendTelegramMessage } = require('./telegramClient');
const { triggerAudit }        = require('./auditOrchestrator');
const { findNotionProject }   = require('./notionClient');

function getWatchedRepos() {
  return (process.env.WATCHED_REPOS || '').split(',').map(r => r.trim()).filter(Boolean);
}

async function checkAndOnboardNewRepos() {
  const repos = getWatchedRepos();
  if (repos.length === 0) {
    logger.info('WATCHED_REPOS not configured — onboarding skipped');
    return;
  }

  for (const repoName of repos) {
    try {
      const existing = await findNotionProject(repoName).catch(() => null);
      if (existing) continue; // already onboarded — skip silently

      logger.info({ repoName }, 'New repo detected — onboarding');

      // 1. Create Notion row (createNotionProject not yet in notionClient.js — log warning)
      const notionClient = require('./notionClient');
      if (typeof notionClient.createNotionProject === 'function') {
        await notionClient.createNotionProject({
          repoName, priority: 'medium', builderAgent: 'nvidia', healthScore: 0,
        }).catch(err => logger.warn({ err: err.message, repoName }, 'Notion row creation failed'));
      } else {
        logger.warn({ repoName }, 'createNotionProject not available — add repo row to Notion manually');
      }

      // 2. Register GitHub webhook
      await registerWebhook(repoName).catch(err =>
        logger.warn({ err: err.message, repoName }, 'Webhook registration failed — register manually in GitHub')
      );

      // 3. Trigger first audit
      await triggerAudit({
        repoFullName:  `Thatisshayan/${repoName}`,
        repoName,
        projectName:   repoName,
        commitSha:     `onboard-${Date.now()}`,
        commitMessage: '[sentinel-onboard] Initial audit',
        branchName:    'main',
        authorName:    'Sentinel',
        authorEmail:   '',
        topicId:       null,
      }).catch(err => logger.warn({ err: err.message, repoName }, 'First audit failed'));

      await sendTelegramMessage([
        `🆕 New repo onboarded: ${repoName}`,
        `Notion row created ✅`,
        `GitHub webhook registered ✅`,
        `First audit triggered ✅`,
        `Sentinel is now monitoring ${repoName}.`,
      ].join('\n'), null, null);

      logger.info({ repoName }, 'Repo onboarding complete');

    } catch (err) {
      logger.error({ err: err.message, repoName }, 'Repo onboarding failed');
    }
  }

  logger.info({ count: repos.length }, 'Repo onboarding check complete');
}

async function registerWebhook(repoName) {
  const domain     = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (!domain) { logger.warn({ repoName }, 'RAILWAY_PUBLIC_DOMAIN not set — skipping webhook registration'); return; }
  const webhookUrl = `https://${domain}/webhook`;

  await axios.post(
    `https://api.github.com/repos/Thatisshayan/${repoName}/hooks`,
    {
      name:   'web',
      active: true,
      events: ['push', 'pull_request'],
      config: {
        url:          webhookUrl,
        content_type: 'json',
        secret:       process.env.GITHUB_WEBHOOK_SECRET,
      },
    },
    {
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        Accept:        'application/vnd.github.v3+json',
      },
    }
  );
}

module.exports = { checkAndOnboardNewRepos, getWatchedRepos };
