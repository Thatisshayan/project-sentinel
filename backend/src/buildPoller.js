const axios  = require('axios');
const logger = require('./logger');

const GITHUB_TOKEN  = () => process.env.GITHUB_TOKEN;
const VERCEL_TOKEN  = () => process.env.VERCEL_TOKEN;
const RAILWAY_TOKEN = () => process.env.RAILWAY_TOKEN;

// ── GitHub Actions ────────────────────────────────────────────────────────────

async function checkGitHubActions(repoFullName, commitSha) {
  try {
    const headers = {
      Authorization: `Bearer ${GITHUB_TOKEN()}`,
      Accept:        'application/vnd.github+json',
    };

    const runsRes = await axios.get(
      `https://api.github.com/repos/${repoFullName}/actions/runs`,
      { headers, params: { head_sha: commitSha, per_page: 10 } }
    );

    const runs = runsRes.data.workflow_runs || [];
    if (runs.length === 0) return { provider: 'github_actions', status: 'not_configured' };

    // Find the most relevant run
    const activeRun = runs.find(r => r.status !== 'completed') || runs[0];

    let status = 'pending';
    if (activeRun.status === 'completed') {
      status = activeRun.conclusion === 'success' ? 'success' : 'failed';
    }

    // Get failed job details if failed
    let failedJobName = null;
    let logsUrl       = null;

    if (status === 'failed') {
      try {
        const jobsRes = await axios.get(
          `https://api.github.com/repos/${repoFullName}/actions/runs/${activeRun.id}/jobs`,
          { headers }
        );
        const failedJob = (jobsRes.data.jobs || []).find(j => j.conclusion === 'failure');
        if (failedJob) {
          failedJobName = failedJob.name;
          logsUrl       = failedJob.logs_url;
        }
      } catch (e) {
        logger.warn({ err: e.message }, 'Could not fetch GitHub Actions job details');
      }
    }

    return {
      provider:     'github_actions',
      status,
      workflowName: activeRun.name,
      runUrl:       activeRun.html_url,
      failedJobName,
      logsUrl,
      conclusion:   activeRun.conclusion,
    };
  } catch (err) {
    logger.warn({ err: err.message, repoFullName }, 'GitHub Actions check failed');
    return { provider: 'github_actions', status: 'unknown', error: err.message };
  }
}

// ── Vercel ────────────────────────────────────────────────────────────────────

async function checkVercel(repoFullName, commitSha) {
  if (!VERCEL_TOKEN()) return { provider: 'vercel', status: 'not_configured' };

  try {
    const res = await axios.get('https://api.vercel.com/v6/deployments', {
      headers: { Authorization: `Bearer ${VERCEL_TOKEN()}` },
      params:  { limit: 10 },
    });

    const deployments = res.data.deployments || [];
    const match = deployments.find(d =>
      d.meta && d.meta.githubCommitSha === commitSha
    );

    if (!match) return { provider: 'vercel', status: 'not_configured' };

    const statusMap = {
      READY:    'success',
      ERROR:    'failed',
      CANCELED: 'cancelled',
      BUILDING: 'pending',
      QUEUED:   'pending',
    };

    return {
      provider:      'vercel',
      status:        statusMap[match.state] || 'unknown',
      deploymentUrl: match.url ? `https://${match.url}` : null,
      inspectUrl:    match.inspectorUrl || null,
      failureReason: match.errorMessage || null,
    };
  } catch (err) {
    logger.warn({ err: err.message }, 'Vercel check failed');
    return { provider: 'vercel', status: 'unknown', error: err.message };
  }
}

// ── Railway ───────────────────────────────────────────────────────────────────

async function checkRailway(repoFullName, commitSha) {
  if (!RAILWAY_TOKEN()) return { provider: 'railway', status: 'not_configured' };

  try {
    const res = await axios.post(
      'https://backboard.railway.app/graphql/v2',
      {
        query: `
          query Deployments($projectId: String!) {
            deployments(input: { projectId: $projectId }, first: 10) {
              edges {
                node {
                  id
                  status
                  staticUrl
                  meta
                  createdAt
                }
              }
            }
          }
        `,
        variables: { projectId: process.env.RAILWAY_PROJECT_ID },
      },
      {
        headers: {
          Authorization: `Bearer ${RAILWAY_TOKEN()}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const edges = res.data?.data?.deployments?.edges || [];
    const match = edges.find(e =>
      e.node.meta && e.node.meta.commitHash === commitSha
    );

    if (!match) return { provider: 'railway', status: 'not_configured' };

    const node = match.node;
    const statusMap = {
      SUCCESS:  'success',
      FAILED:   'failed',
      CRASHED:  'failed',
      BUILDING: 'pending',
      DEPLOYING: 'pending',
      REMOVED:  'cancelled',
    };

    return {
      provider:      'railway',
      status:        statusMap[node.status] || 'unknown',
      deploymentUrl: node.staticUrl || null,
      failureReason: null,
    };
  } catch (err) {
    logger.warn({ err: err.message }, 'Railway check failed');
    return { provider: 'railway', status: 'unknown', error: err.message };
  }
}

// ── Aggregate ─────────────────────────────────────────────────────────────────

async function checkAllProviders(repoFullName, commitSha) {
  const [github, vercel, railway] = await Promise.all([
    checkGitHubActions(repoFullName, commitSha),
    checkVercel(repoFullName, commitSha),
    checkRailway(repoFullName, commitSha),
  ]);

  const results = [github, vercel, railway].filter(
    r => r.status !== 'not_configured'
  );

  if (results.length === 0) {
    return { overall: 'not_configured', providers: [github, vercel, railway] };
  }

  const statuses = results.map(r => r.status);

  let overall;
  if (statuses.some(s => s === 'failed'))       overall = 'failed';
  else if (statuses.some(s => s === 'pending')) overall = 'pending';
  else if (statuses.every(s => s === 'success')) overall = 'success';
  else overall = 'unknown';

  // Find the most useful failure details
  const failedProvider = results.find(r => r.status === 'failed');

  return {
    overall,
    providers:      [github, vercel, railway],
    primaryFailure: failedProvider || null,
    buildUrl:       failedProvider?.runUrl || failedProvider?.deploymentUrl || null,
    logsUrl:        failedProvider?.logsUrl || null,
    failureReason:  failedProvider?.failureReason || failedProvider?.conclusion || null,
    buildProvider:  failedProvider?.provider || results[0]?.provider || 'unknown',
  };
}

module.exports = { checkAllProviders, checkGitHubActions, checkVercel, checkRailway };
