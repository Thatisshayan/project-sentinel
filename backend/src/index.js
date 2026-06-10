import express from 'express';
import { config } from './config.js';
import { parsePushEvent, detectHighRiskChange } from './github/webhook.js';
import { queryDatabase, findProjectByRepo, updatePage, appendBlocks } from './notion/client.js';
import { sendMessage, buildReport, buildFailureReport, buildUnknownRepoWarning } from './telegram/reporter.js';
import { computeRiskLevel } from './utils/risk.js';
import { checkGitHubActions } from './build/github-actions.js';
import { checkVercel } from './build/vercel.js';
import { checkRailway } from './build/railway-check.js';

const app = express();

app.use(express.json({ limit: '5mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/webhook/github', async (req, res) => {
  const event = req.headers['x-github-event'];

  if (event !== 'push') {
    return res.status(200).json({ ignored: true, reason: `event ${event} not handled` });
  }

  res.status(202).json({ received: true });

  try {
    await handlePushEvent(req.body);
  } catch (err) {
    console.error('Error handling push event:', err);
    await sendMessage(`Project Sentinel error: ${err.message}`).catch(() => {});
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
      }));
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
    const ghaResult = await checkGitHubActions(owner, repo, event.commitHash);
    const vercelResult = await checkVercel(null, event.commitHash);
    const railwayResult = await checkRailway(event.commitHash);

    const results = [ghaResult, vercelResult, railwayResult].filter(r => r.status !== 'not_configured');

    if (results.length === 0) {
      overallBuildStatus = 'not_configured';
      buildProvider = 'None';
    } else {
      const failed = results.some(r => r.status === 'failed');
      const pending = results.some(r => r.status === 'pending');
      overallBuildStatus = failed ? 'failed' : pending ? 'pending' : 'success';

      const providerNames = results.map(r => r.provider).join(', ');
      buildProvider = providerNames;
      buildUrl = results.find(r => r.status === 'failed' || r.status === 'success')?.inspectUrl
        || results.find(r => r.inspectUrl)?.inspectUrl
        || results.find(r => r.deploymentUrl)?.deploymentUrl
        || '';
    }
  } catch (err) {
    console.error('Build check failed:', err.message);
    overallBuildStatus = 'unknown';
  }

  try {
    try {
      const ciStatusMap = { success: 'Passing', failed: 'Failing', pending: 'Unknown', not_configured: 'Unknown', unknown: 'Unknown', cancelled: 'Unknown' };
      const depStatusMap = { success: 'Deployed', failed: 'Degraded', pending: 'Unknown', not_configured: 'Not deployed', unknown: 'Unknown', cancelled: 'Unknown' };

      await updatePage(notionPage.id, {
        'CI Status': { select: { name: ciStatusMap[overallBuildStatus] || 'Unknown' } },
        'Deployment Status': { select: { name: depStatusMap[overallBuildStatus] || 'Unknown' } },
        'Build Provider': overallBuildStatus !== 'not_configured' ? { select: { name: buildProvider } } : undefined,
        'Build URL': buildUrl ? { url: buildUrl } : undefined,
      });
    } catch (err) {
      console.error('Status update failed:', err.message);
    }

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
      debuggerTriggered: false,
      commitUrl: event.commitUrl,
    });

    await sendMessage(report);

    if (overallBuildStatus === 'failed' && !highRisk.isHighRisk) {
      await sendMessage(buildFailureReport({
        project: projectName,
        repo: event.repoName,
        branch: event.branchName,
        commitMessage: event.commitMessage,
        buildProvider,
        buildUrl,
        failureReason: 'Build failed — debugger will attempt fix.',
        attempt: 1,
      }));
    } else if (overallBuildStatus === 'failed' && highRisk.isHighRisk) {
      await sendMessage(
        `Project Sentinel stopped automatic repair because the failure appears high-risk or environment-related.\nHuman review required.`
      );
    }
  } catch (err) {
    console.error('Telegram report failed:', err.message);
  }
}

app.listen(config.port, () => {
  console.log(`Project Sentinel backend running on port ${config.port}`);
});
