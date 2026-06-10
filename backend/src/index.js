import express from 'express';
import crypto from 'crypto';
import { config } from './config.js';
import { parsePushEvent, detectHighRiskChange } from './github/webhook.js';
import { queryDatabase, findProjectByRepo, updatePage, appendBlocks } from './notion/client.js';
import { sendMessage, buildReport, buildFailureReport, buildUnknownRepoWarning } from './telegram/reporter.js';
import { computeRiskLevel } from './utils/risk.js';
import { generateSummary } from './utils/summarize.js';
import { checkGitHubActions } from './build/github-actions.js';
import { checkVercel } from './build/vercel.js';
import { checkRailway } from './build/railway-check.js';
import { handleTelegramUpdate, registerTelegramWebhook } from './telegram/commands.js';
import { writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';

const opencodeApiKey = config.debugger.openCodeApiKey;
if (opencodeApiKey) {
  const dir = `${homedir()}/.local/share/opencode`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/auth.json`, JSON.stringify({
    'opencode-go': { type: 'api', key: opencodeApiKey },
  }));
  writeFileSync(`${dir}/account.json`, JSON.stringify({
    version: 2,
    accounts: {
      [`acc_${Date.now()}`]: {
        id: `acc_${Date.now()}`,
        serviceID: 'opencode-go',
        description: 'default',
        credential: { type: 'api', key: opencodeApiKey },
      },
    },
    active: { 'opencode-go': `acc_${Date.now()}` },
  }));
  console.log('OpenCode auth configured');
}

const app = express();

app.use(express.json({ limit: '5mb' }));

app.post('/webhook/telegram', async (req, res) => {
  res.status(200).end();
  try {
    await handleTelegramUpdate(req.body);
  } catch (err) {
    console.error('Telegram command error:', err.message);
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

function verifyWebhookSignature(req, body) {
  const secret = config.github.webhookSecret;
  if (!secret) return true;
  const sig = req.headers['x-hub-signature-256'];
  if (!sig) return false;
  if (!sig.startsWith('sha256=')) return false;
  const hmac = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  const expected = `sha256=${hmac}`;
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

app.post('/webhook/github', async (req, res) => {
  if (!verifyWebhookSignature(req, req.body)) {
    console.error('Invalid webhook signature');
    return res.status(401).json({ error: 'invalid signature' });
  }

  const event = req.headers['x-github-event'];

  if (event !== 'push') {
    return res.status(200).json({ ignored: true, reason: `event ${event} not handled` });
  }

  res.status(202).json({ received: true });

  try {
    await handlePushEvent(req.body);
  } catch (err) {
    console.error('Error handling push event:', err);
    await sendMessage(`Project Sentinel error: ${err.message}`, '').catch(() => {});
  }
});

async function handlePushEvent(payload) {
  const event = parsePushEvent(payload);
  console.log(`Received push: ${event.repoName} / ${event.branchName} / ${event.commitHash?.slice(0, 7)}`);

  const riskLevel = computeRiskLevel(event.changedFiles, event.commitMessage);
  const highRisk = detectHighRiskChange(event);

  let notionUpdated = false;
  let changelogAppended = false;
  let projectName = event.repoName;
  let notionPage = null;

  try {
    const dbResults = await queryDatabase();
    const results = dbResults.results || [];
    notionPage = findProjectByRepo(results, event.repoName);

    if (!notionPage) {
      await sendMessage(buildUnknownRepoWarning({
        repoName: event.repoName,
        branch: event.branchName,
        repoUrl: event.repoUrl,
        commitMessage: event.commitMessage,
      }), event.repoName);
      console.log(`No Notion match for repo: ${event.repoName}`);
      return;
    }

    projectName = notionPage.properties?.ProjectName?.title?.[0]?.plain_text || event.repoName;

    const properties = {
      'Last Commit Message': { rich_text: [{ text: { content: event.commitMessage || '' } }] },
      'Last Commit Hash': { rich_text: [{ text: { content: event.commitHash || '' } }] },
      'Last Commit URL': { url: event.commitUrl || null },
      'Last Branch': { rich_text: [{ text: { content: event.branchName || '' } }] },
      'Last Commit Author': { rich_text: [{ text: { content: event.authorName || '' } }] },
      'Last Commit Date': { date: { start: event.commitTimestamp?.split('T')[0] || new Date().toISOString().split('T')[0] } },
      'Changed Files': { rich_text: [{ text: { content: (event.changedFilesText || '').slice(0, 2000) } }] },
      'Files Changed Count': { number: event.filesChangedCount || 0 },
      'Risk Level': { select: { name: riskLevel } },
    };

    await updatePage(notionPage.id, properties);
    notionUpdated = true;
    console.log('Notion ground truth updated');

    try {
      const changelogBlocks = [
        {
          heading_3: {
            rich_text: [{ text: { content: `Project Sentinel Update — ${new Date().toISOString().split('T')[0]}` } }],
          },
        },
        {
          bulleted_list_item: {
            rich_text: [{ text: { content: `Repo: ${event.repoName}` } }],
          },
        },
        {
          bulleted_list_item: {
            rich_text: [{ text: { content: `Branch: ${event.branchName}` } }],
          },
        },
        {
          bulleted_list_item: {
            rich_text: [{ text: { content: `Commit: ${event.commitHash?.slice(0, 7)} — ${event.commitMessage}` } }],
          },
        },
        {
          bulleted_list_item: {
            rich_text: [{ text: { content: `Author: ${event.authorName}` } }],
          },
        },
        {
          bulleted_list_item: {
            rich_text: [{ text: { content: `Files changed: ${event.filesChangedCount}` } }],
          },
        },
        {
          bulleted_list_item: {
            rich_text: [{ text: { content: `Risk: ${riskLevel}` } }],
          },
        },
      ];

      await appendBlocks(notionPage.id, changelogBlocks);
      changelogAppended = true;
      console.log('Changelog appended');
    } catch (err) {
      console.error('Changelog append failed:', err.message);
    }
  } catch (err) {
    console.error('Notion update failed:', err.message);
  }

  let overallBuildStatus = 'not_configured';
  let buildProvider = 'None';
  let buildUrl = '';

  try {
    const [owner, repo] = (event.repoFullName || '/').split('/');

    const maxWait = 600000; // 10 minutes
    const pollInterval = 30000; // 30 seconds
    const startTime = Date.now();

    let ghaResult, vercelResult, railwayResult;
    let pending = true;

    while (pending && (Date.now() - startTime) < maxWait) {
      ghaResult = await checkGitHubActions(owner, repo, event.commitHash);
      vercelResult = await checkVercel(null, event.commitHash);
      railwayResult = await checkRailway(event.commitHash);

      const results = [ghaResult, vercelResult, railwayResult].filter(r => r.status !== 'not_configured');

      if (results.length === 0) {
        overallBuildStatus = 'not_configured';
        buildProvider = 'None';
        pending = false;
      } else {
        const failed = results.some(r => r.status === 'failed');
        const hasPending = results.some(r => r.status === 'pending');
        const allSuccess = results.every(r => r.status === 'success');

        if (failed) {
          overallBuildStatus = 'failed';
          pending = false;
        } else if (allSuccess) {
          overallBuildStatus = 'success';
          pending = false;
        } else if (hasPending) {
          overallBuildStatus = 'pending';
          await new Promise(r => setTimeout(r, pollInterval));
        } else {
          overallBuildStatus = 'unknown';
          pending = false;
        }

        const providerNames = results.map(r => r.provider).join(', ');
        buildProvider = providerNames;
        buildUrl = results.find(r => r.status === 'failed' || r.status === 'success')?.inspectUrl
          || results.find(r => r.inspectUrl)?.inspectUrl
          || results.find(r => r.deploymentUrl)?.deploymentUrl
          || '';
      }
    }

    if (pending) {
      overallBuildStatus = 'pending_timeout';
      console.log('Build status polling timed out after 10 minutes');
    }
  } catch (err) {
    console.error('Build check failed:', err.message);
    overallBuildStatus = 'unknown';
  }

  try {
    try {
      const ciStatusMap = { success: 'Passing', failed: 'Failing', pending: 'Unknown', pending_timeout: 'Unknown', not_configured: 'Unknown', unknown: 'Unknown', cancelled: 'Unknown' };
      const depStatusMap = { success: 'Deployed', failed: 'Degraded', pending: 'Unknown', pending_timeout: 'Unknown', not_configured: 'Not deployed', unknown: 'Unknown', cancelled: 'Unknown' };

      await updatePage(notionPage.id, {
        'CI Status': { select: { name: ciStatusMap[overallBuildStatus] || 'Unknown' } },
        'Deployment Status': { select: { name: depStatusMap[overallBuildStatus] || 'Unknown' } },
        'Build Provider': overallBuildStatus !== 'not_configured' ? { select: { name: buildProvider } } : undefined,
        'Build URL': buildUrl ? { url: buildUrl } : undefined,
      });
    } catch (err) {
      console.error('Status update failed:', err.message);
    }

    const aiSummary = generateSummary(event.commitMessage, event.changedFiles);
    const report = buildReport({
      project: projectName,
      repo: event.repoName,
      branch: event.branchName,
      commitMessage: event.commitMessage,
      author: event.authorName,
      filesChanged: event.filesChangedCount,
      risk: riskLevel,
      buildStatus: overallBuildStatus,
      buildProvider,
      buildUrl,
      notionUpdated,
      changelogAppended,
      debuggerTriggered: overallBuildStatus === 'failed',
      commitUrl: event.commitUrl,
      summary: aiSummary,
    });

    await sendMessage(report, event.repoName);

    if (overallBuildStatus === 'failed') {
      const failureReason = 'Build failed — see build URL for details.';

      if (highRisk.isHighRisk) {
        await sendMessage(
          `Project Sentinel stopped automatic repair because the failure appears high-risk or environment-related.\nHuman review required.`,
          event.repoName
        );
      } else {
        await sendMessage(buildFailureReport({
          project: projectName, repo: event.repoName, branch: event.branchName,
          commitMessage: event.commitMessage, buildProvider, buildUrl,
          failureReason, attempt: 1,
        }), event.repoName);

        await sendMessage(
          `💡 To trigger the debugger manually, reply with:\n/sentinel fix ${event.repoName}`,
          event.repoName
        );
      }
    }
  } catch (err) {
    console.error('Telegram report failed:', err.message);
  }
}

app.listen(config.port, async () => {
  console.log(`Project Sentinel backend running on port ${config.port}`);
  try {
    await registerTelegramWebhook();
  } catch (err) {
    console.error('Failed to register Telegram webhook:', err.message);
  }
});
