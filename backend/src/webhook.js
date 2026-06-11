const express                                              = require('express');
const crypto                                               = require('crypto');
const rateLimit                                            = require('express-rate-limit');
const logger                                               = require('./logger');
const { extractPayload }                                   = require('./extractPayload');
const { findNotionProject, updateNotionProject,
        appendChangelog }                                  = require('./notionClient');
const { sendTelegramMessage }                              = require('./telegramClient');
const { isAlreadyProcessed, markAsProcessed }              = require('./deduplication');
const { enqueueBuildCheck }                                = require('./queueClient');

const router = express.Router();

const limiter = rateLimit({
  windowMs:        60 * 1000,
  max:             60,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many requests — slow down' },
});

function verifySignature(req, res, next) {
  const signature = req.headers['x-hub-signature-256'];

  if (!signature) {
    logger.warn({ ip: req.ip }, 'Webhook received without x-hub-signature-256 header');
    return res.status(401).json({ error: 'Missing signature header' });
  }

  const body     = JSON.stringify(req.body);
  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET)
    .update(body)
    .digest('hex');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);

  const validLength = sigBuf.length === expBuf.length;
  const validHmac   = validLength && crypto.timingSafeEqual(sigBuf, expBuf);

  if (!validHmac) {
    logger.warn({ ip: req.ip }, 'Webhook signature verification failed');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  next();
}

function buildSuccessMessage(data, changelogAppended) {
  const {
    projectName, repoName, branchName, commitMessage,
    authorName, filesChangedCount, isMarketingOnlyUpdate,
    commitUrl, riskLevel, commitSha,
  } = data;

  return [
    `Project Sentinel update ✅`,
    ``,
    `Project: ${projectName}`,
    `Repo: ${repoName}`,
    `Branch: ${branchName}`,
    `Commit: ${commitMessage}`,
    `Hash: ${commitSha.substring(0, 7)}`,
    `Author: ${authorName}`,
    `Files changed: ${filesChangedCount}`,
    `Marketing update: ${isMarketingOnlyUpdate ? 'Yes' : 'No'}`,
    `Risk: ${riskLevel}`,
    ``,
    `Notion: ✅ Updated`,
    `Changelog: ${changelogAppended ? '✅ Appended' : '⚠️ Failed (non-blocking)'}`,
    ``,
    `Commit: ${commitUrl}`,
  ].join('\n');
}

function buildUnknownRepoMessage(data) {
  const { repoName, branchName, repoUrl, commitMessage } = data;

  return [
    `Project Sentinel warning ⚠️`,
    ``,
    `Unknown repo received: ${repoName}`,
    `Branch: ${branchName}`,
    `Repo URL: ${repoUrl}`,
    `Commit: ${commitMessage}`,
    ``,
    `No matching project found in Notion.`,
    `Check the "Repo Name" field in Projects Command Center.`,
  ].join('\n');
}

function buildErrorMessage(context, repoName, detail) {
  return [
    `Project Sentinel error ❌`,
    ``,
    `Repo: ${repoName}`,
    `Problem: ${context}`,
    `Detail: ${String(detail).substring(0, 300)}`,
  ].join('\n');
}

async function processWebhook(payload) {
  let data;
  try {
    data = extractPayload(payload);
  } catch (err) {
    logger.error({ err: err.message }, 'Payload extraction failed — cannot process');
    return;
  }

  const { repoName, repoNameLower, commitSha, branchName } = data;

  logger.info(
    { repoName, commitSha: commitSha.substring(0, 7), branch: branchName },
    'Processing webhook'
  );

  const seen = await isAlreadyProcessed(repoName, commitSha);
  if (seen) {
    logger.info({ repoName, commitSha: commitSha.substring(0, 7) }, 'Duplicate — skipping');
    return;
  }
  await markAsProcessed(repoName, commitSha);

  let notionProject;
  try {
    notionProject = await findNotionProject(repoNameLower);
  } catch (err) {
    logger.error({ err: err.message, repoName }, 'Notion search threw an error');
    await sendTelegramMessage(
      buildErrorMessage('Notion search failed', repoName, err.message),
      repoName
    ).catch(() => {});
    return;
  }

  if (!notionProject) {
    logger.warn({ repoName }, 'No matching Notion project');
    await sendTelegramMessage(buildUnknownRepoMessage(data), repoName).catch(() => {});
    return;
  }

  data.projectName  = notionProject.projectName;
  data.notionPageId = notionProject.pageId;

  logger.info(
    { repoName, projectName: notionProject.projectName },
    'Matched Notion project'
  );

  try {
    await updateNotionProject(notionProject.pageId, data);
  } catch (err) {
    logger.error({ err: err.message, repoName }, 'Notion update failed');
    await sendTelegramMessage(
      buildErrorMessage('Notion update failed', repoName, err.message),
      repoName
    ).catch(() => {});
    return;
  }

  let changelogAppended = false;
  try {
    await appendChangelog(notionProject.pageId, data);
    changelogAppended = true;
  } catch (err) {
    logger.warn({ err: err.message, repoName }, 'Changelog append failed — continuing');
  }

  try {
    await sendTelegramMessage(buildSuccessMessage(data, changelogAppended), repoName);
  } catch (err) {
    logger.error({ err: err.message, repoName }, 'Telegram send failed');
  }

  // Phase 2 extension: queue build status check
  // Only queue if we found a matching Notion project
  if (notionProject) {
    try {
      await enqueueBuildCheck({
        projectName:   notionProject.projectName,
        repoName:      data.repoName,
        repoFullName:  data.repoFullName,
        branchName:    data.branchName,
        commitSha:     data.commitSha,
        commitUrl:     data.commitUrl,
        commitMessage: data.commitMessage,
        authorName:    data.authorName,
        changedFiles:  data.changedFiles,
        topicId:       notionProject.topicId || null,
      });
      logger.info({ repoName: data.repoName }, 'Build check job queued');
    } catch (err) {
      logger.warn({ err: err.message }, 'Failed to queue build check — non-blocking');
    }
  }

  logger.info(
    { repoName, projectName: notionProject.projectName, changelogAppended },
    'Webhook processing complete'
  );
}

router.post('/github', limiter, verifySignature, (req, res) => {
  res.status(200).json({ received: true });

  processWebhook(req.body).catch(err => {
    logger.error({ err: err.message }, 'Unhandled error in processWebhook');
  });
});

module.exports = router;
