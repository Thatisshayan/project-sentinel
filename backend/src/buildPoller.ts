import axios from 'axios';
import logger from './logger';

const GITHUB_TOKEN  = (): string | undefined => process.env['GITHUB_TOKEN'];
const VERCEL_TOKEN  = (): string | undefined => process.env['VERCEL_TOKEN'];
const RAILWAY_TOKEN = (): string | undefined => process.env['RAILWAY_TOKEN'];

// ── GitHub Actions ────────────────────────────────────────────────────────────

interface GitHubRunResult {
  provider: string;
  status: string;
  workflowName?: string;
  runUrl?: string;
  failedJobName?: string | null;
  logsUrl?: string | null;
  conclusion?: string | null;
  error?: string;
}

async function checkGitHubActions(repoFullName: string, commitSha: string): Promise<GitHubRunResult> {
  try {
    const headers = {
      Authorization: `Bearer ${GITHUB_TOKEN()}`,
      Accept:        'application/vnd.github+json',
    };

    const runsRes = await axios.get(
      `https://api.github.com/repos/${repoFullName}/actions/runs`,
      { headers, params: { head_sha: commitSha, per_page: 10 } }
    );

    let runs = runsRes.data.workflow_runs || [];

    // Fix 1: SHA lookup may return empty if GitHub hasn't registered the run yet
    // (typically 20-40s after push). Fall back to the most recent run if it was
    // created within the last 5 minutes.
    if (runs.length === 0) {
      try {
        const recentRes = await axios.get(
          `https://api.github.com/repos/${repoFullName}/actions/runs`,
          { headers, params: { per_page: 5 } }
        );
        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
        const latestRun = (recentRes.data.workflow_runs || []).find((r: any) =>
          new Date(r.created_at).getTime() > fiveMinutesAgo
        );
        if (latestRun) {
          runs = [latestRun];
          logger.info({ repoFullName, runId: latestRun.id },
            'SHA lookup empty — using latest recent run as fallback');
        }
      } catch (e: any) {
        logger.warn({ err: e.message }, 'Branch fallback run lookup failed');
      }
    }

    // Fix 3: if still no runs found, return pending so the poller retries
    // rather than treating the repo as unconfigured and giving up
    if (runs.length === 0) return { provider: 'github_actions', status: 'pending' };

    // Find the most relevant run
    const activeRun = runs.find((r: any) => r.status !== 'completed') || runs[0];

    let status = 'pending';
    if (activeRun.status === 'completed') {
      status = activeRun.conclusion === 'success' ? 'success' : 'failed';
    }

    // Get failed job details if failed
    let failedJobName: string | null = null;
    let logsUrl: string | null       = null;

    if (status === 'failed') {
      try {
        const jobsRes = await axios.get(
          `https://api.github.com/repos/${repoFullName}/actions/runs/${activeRun.id}/jobs`,
          { headers }
        );
        const failedJob = (jobsRes.data.jobs || []).find((j: any) => j.conclusion === 'failure');
        if (failedJob) {
          failedJobName = failedJob.name;
          logsUrl       = failedJob.logs_url;
        }
      } catch (e: any) {
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
  } catch (err: any) {
    logger.warn({ err: err.message, repoFullName }, 'GitHub Actions check failed');
    return { provider: 'github_actions', status: 'unknown', error: err.message };
  }
}

// ── Vercel ────────────────────────────────────────────────────────────────────

interface VercelResult {
  provider: string;
  status: string;
  deploymentUrl?: string | null;
  inspectUrl?: string | null;
  failureReason?: string | null;
  error?: string;
}

async function checkVercel(repoFullName: string, commitSha: string): Promise<VercelResult> {
  if (!VERCEL_TOKEN()) return { provider: 'vercel', status: 'not_configured' };

  try {
    const res = await axios.get('https://api.vercel.com/v6/deployments', {
      headers: { Authorization: `Bearer ${VERCEL_TOKEN()}` },
      params:  { limit: 10 },
    });

    const deployments = res.data.deployments || [];
    const match = deployments.find((d: any) =>
      d.meta && d.meta.githubCommitSha === commitSha
    );

    if (!match) return { provider: 'vercel', status: 'not_configured' };

    const statusMap: Record<string, string> = {
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
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Vercel check failed');
    return { provider: 'vercel', status: 'unknown', error: err.message };
  }
}

// ── Railway ───────────────────────────────────────────────────────────────────

interface RailwayResult {
  provider: string;
  status: string;
  deploymentUrl?: string | null;
  buildUrl?: string;
  failureReason?: string | null;
  error?: string;
}

async function checkRailway(repoFullName: string, commitSha: string): Promise<RailwayResult> {
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
        variables: { projectId: process.env['RAILWAY_PROJECT_ID'] },
      },
      {
        headers: {
          Authorization: `Bearer ${RAILWAY_TOKEN()}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const edges = res.data?.data?.deployments?.edges || [];

    // Try exact SHA match first
    let match = edges.find((e: any) =>
      e.node.meta && e.node.meta.commitHash === commitSha
    );

    // Fallback: Railway often doesn't store commitHash in meta for auto-deploys.
    // Use the most recent deployment created in the last 15 minutes.
    if (!match) {
      const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;
      match = edges.find((e: any) =>
        new Date(e.node.createdAt).getTime() > fifteenMinutesAgo &&
        ['SUCCESS', 'FAILED', 'CRASHED', 'BUILDING', 'DEPLOYING'].includes(e.node.status)
      );
      if (match) {
        logger.info({ repoFullName, status: match.node.status },
          'Railway SHA match failed — using most recent deployment as fallback');
      }
    }

    if (!match) return { provider: 'railway', status: 'not_configured' };

    const node = match.node;
    const statusMap: Record<string, string> = {
      SUCCESS:   'success',
      FAILED:    'failed',
      CRASHED:   'failed',
      BUILDING:  'pending',
      DEPLOYING: 'pending',
      REMOVED:   'cancelled',
    };

    return {
      provider:      'railway',
      status:        statusMap[node.status] || 'unknown',
      deploymentUrl: node.staticUrl || null,
      buildUrl:      `https://railway.app/project/${process.env['RAILWAY_PROJECT_ID']}`,
      failureReason: (node.status === 'FAILED' || node.status === 'CRASHED')
        ? `Railway deployment ${node.status.toLowerCase()} — check Railway dashboard`
        : null,
    };
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Railway check failed');
    return { provider: 'railway', status: 'unknown', error: err.message };
  }
}

// ── Aggregate ─────────────────────────────────────────────────────────────────

interface AggregateResult {
  overall: string;
  providers: Array<GitHubRunResult | VercelResult | RailwayResult>;
  primaryFailure?: GitHubRunResult | VercelResult | RailwayResult | null;
  buildUrl?: string | null;
  logsUrl?: string | null;
  failureReason?: string | null;
  buildProvider?: string;
}

async function checkAllProviders(repoFullName: string, commitSha: string): Promise<AggregateResult> {
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

  let overall: string;
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
    buildUrl:       (failedProvider as GitHubRunResult)?.runUrl || (failedProvider as VercelResult)?.deploymentUrl || null,
    logsUrl:        (failedProvider as GitHubRunResult)?.logsUrl || null,
    failureReason:  (failedProvider as any)?.failureReason || (failedProvider as GitHubRunResult)?.conclusion || null,
    buildProvider:  (failedProvider as any)?.provider || results[0]?.provider || 'unknown',
  };
}

export = { checkAllProviders, checkGitHubActions, checkVercel, checkRailway };
