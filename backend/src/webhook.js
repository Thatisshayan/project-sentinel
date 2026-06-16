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
const { query }                                            = require('./dbClient');
const { upsertRepoMetrics }                                = require('./portfolioDb');

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

  // Use the raw request bytes (captured by express.json's verify hook in
  // index.js), not JSON.stringify(req.body) — re-serializing the parsed
  // object does not reproduce GitHub's original byte stream (whitespace,
  // key order, escaping can differ), which would cause valid webhooks to
  // intermittently fail signature verification.
  const body     = req.rawBody || Buffer.from(JSON.stringify(req.body));
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
    // T13 — fetch all page titles so user knows what names exist in Notion
    let suggestionNote = '';
    try {
      const { Client } = require('@notionhq/client');
      const nc = new Client({ auth: process.env.NOTION_API_KEY });
      const resp = await nc.databases.query({
        database_id: process.env.NOTION_DATABASE_ID,
        page_size: 20,
      }).catch(() => null);
      if (resp?.results?.length) {
        const names = resp.results.map(p => {
          const t = p.properties['Name'] || p.properties['Project'] || p.properties['Title'];
          return t?.title?.[0]?.plain_text || '(untitled)';
        }).filter(Boolean);
        suggestionNote = `\n\nExisting Notion pages: ${names.join(', ')}\nAdd a "Repo Name" property with value "${repoName}" to the matching page.`;
      }
    } catch {}
    await sendTelegramMessage(buildUnknownRepoMessage(data) + suggestionNote, repoName).catch(() => {});
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

  upsertRepoMetrics({
    repoFullName: data.repoFullName,
    repoName:     data.repoName,
    lastCommitAt: data.commitTimestamp ? new Date(data.commitTimestamp) : new Date(),
    buildStatus:  'unknown',
    healthScore:  6.5,
    priority:     'medium',
  }).catch(err => logger.warn({ err: err.message }, 'Metrics upsert failed — non-blocking'));

  // T11 — trigger security scan immediately on high-risk pushes (don't wait for build pass)
  if (notionProject && data.riskLevel === 'High') {
    try {
      const { runSecurityScan } = require('./securityScanner');
      runSecurityScan({
        repoFullName:  data.repoFullName,
        repoName:      data.repoName,
        commitSha:     data.commitSha,
        branchName:    data.branchName,
        topicId:       notionProject.topicId || null,
      }).catch(err => logger.warn({ err: err.message }, 'High-risk security scan failed — non-blocking'));
      logger.info({ repoName: data.repoName, risk: 'High' }, 'Security scan triggered for high-risk push');
    } catch {}
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

  // T8 — notify dependent repos that this repo changed
  try {
    const { notifyDependents } = require('./crossRepoCoordinator');
    notifyDependents(repoName, data.commitSha, data.authorName).catch(() => {});
  } catch {}
}

// ── PR event handler ─────────────────────────────────────────────────────────

async function processPREvent(payload) {
  const { action, pull_request: pr, repository } = payload;
  if (!pr || !repository) return;

  const repoFullName = repository.full_name;
  const branchName   = pr.head?.ref || '';
  const prUrl        = pr.html_url;
  const prNumber     = pr.number;
  const merged       = pr.merged;
  const repoName     = repository.name;

  // Only care about Sentinel-created branches
  if (!branchName.startsWith('sentinel/')) return;
  if (action !== 'closed') return;

  logger.info({ repoFullName, prNumber, merged, branch: branchName }, 'Sentinel PR closed');

  if (merged) {
    // Mark tasks done and trigger next batch
    const updated = await query(`
      UPDATE audit_tasks
      SET status = 'done', updated_at = NOW()
      WHERE repo_full_name = $1
        AND (pr_url = $2 OR pr_number = $3)
        AND status IN ('build_check', 'in_progress')
      RETURNING id, notion_page_id
    `, [repoFullName, prUrl, prNumber]).catch(() => null);

    const taskIds = updated?.rows || [];
    logger.info({ count: taskIds.length, repoFullName }, 'Tasks marked done after PR merge');

    // Update Notion task status for each completed task
    try {
      const { updateNotionTaskStatus } = require('./auditTaskWriter');
      for (const row of taskIds) {
        await updateNotionTaskStatus(row.notion_page_id, 'done', { prUrl }).catch(() => {});
      }
    } catch {}

    await sendTelegramMessage([
      `Project Sentinel — PR Merged ✅`,
      ``,
      `Repo: ${repoName}`,
      `PR #${prNumber} merged`,
      `Branch: ${branchName}`,
      taskIds.length > 0 ? `${taskIds.length} task(s) marked complete` : '',
      ``,
      `Next batch will run on next commit or /sentinel run-sprint ${repoName}`,
    ].filter(Boolean).join('\n'), null, null).catch(() => {});

  } else {
    // PR closed without merge — requeue tasks for retry
    const updated = await query(`
      UPDATE audit_tasks
      SET status = 'queued', branch_name = NULL, commit_sha = NULL,
          pr_url = NULL, pr_number = NULL, updated_at = NOW()
      WHERE repo_full_name = $1
        AND (pr_url = $2 OR pr_number = $3)
        AND status IN ('build_check', 'in_progress')
      RETURNING id
    `, [repoFullName, prUrl, prNumber]).catch(() => null);

    const count = updated?.rows?.length || 0;
    logger.info({ count, repoFullName }, 'Tasks requeued after PR rejection');

    await sendTelegramMessage([
      `Project Sentinel — PR Rejected ⚠️`,
      ``,
      `Repo: ${repoName}`,
      `PR #${prNumber} closed without merging`,
      `Branch: ${branchName}`,
      count > 0 ? `${count} task(s) requeued — /sentinel run-sprint ${repoName} to retry` : '',
    ].filter(Boolean).join('\n'), null, null).catch(() => {});
  }
}

router.post('/github', limiter, verifySignature, (req, res) => {
  res.status(200).json({ received: true });

  const event = req.headers['x-github-event'] || 'push';

  if (event === 'pull_request') {
    processPREvent(req.body).catch(err => {
      logger.error({ err: err.message }, 'Unhandled error in processPREvent');
    });
    return;
  }

  processWebhook(req.body).catch(err => {
    logger.error({ err: err.message }, 'Unhandled error in processWebhook');
  });
});

module.exports = router;
