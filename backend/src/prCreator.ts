import axios from 'axios';
import logger from './logger';
import projectDb from './projectDb';

interface PRContext {
  projectName?: string;
  repoName?: string;
  commitSha?: string | null;
  attemptNumber?: number | null;
  buildProvider?: string;
  failureReason?: string | null;
  kind?: 'task' | 'fix';
}

interface GitHubRepoTarget {
  owner: string;
  repo: string;
  pullsUrl: string;
}

const GITHUB_REPO_FULL_NAME_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function buildPullRequestContent(context: PRContext): { title: string; body: string } {
  const { projectName, repoName, commitSha, attemptNumber, buildProvider, failureReason, kind } = context;
  const shortSha = (commitSha || '').substring(0, 7);
  const isTask = kind === 'task';

  return {
    title: isTask
      ? `feat(sentinel): ${failureReason || 'automated improvement batch'}`
      : `fix(sentinel): repair ${buildProvider} build failure — attempt ${attemptNumber}`,
    body: isTask
      ? [
          `## Project Sentinel — Automated Improvement`,
          ``,
          `**Project:** ${projectName || repoName}`,
          `**Repo:** ${repoName}`,
          `**Commit:** ${shortSha}`,
          ``,
          `### What this batch does`,
          failureReason || 'See commit diff',
          ``,
          `---`,
          `_Opened automatically by Project Sentinel._`,
          `_Review the diff carefully before merging._`,
        ].join('\n')
      : [
          `## Project Sentinel — Automated Fix`,
          ``,
          `**Project:** ${projectName || repoName}`,
          `**Repo:** ${repoName}`,
          `**Attempt:** ${attemptNumber}/5`,
          `**Original failing commit:** ${shortSha}`,
          `**Build provider:** ${buildProvider}`,
          ``,
          `### Failure summary`,
          failureReason || 'See build logs',
          ``,
          `### What Aider changed`,
          `_See commit diff above_`,
          ``,
          `---`,
          `_Opened automatically by Project Sentinel._`,
          `_Review the diff carefully before merging._`,
          `_Merging will re-trigger the build check._`,
        ].join('\n'),
  };
}

async function getExistingPullRequest(
  repoTarget: GitHubRepoTarget,
  fixBranch: string,
  base: string,
  headers: { Authorization: string; Accept: string }
) {
  const existingRes = await axios.get(
    repoTarget.pullsUrl,
    {
      headers,
      params: {
        head: `${repoTarget.owner}:${fixBranch}`,
        base,
        state: 'open',
      },
    }
  );
  return existingRes.data[0] ?? null;
}

async function loadRepoPolicy(repoShortName: string) {
  try {
    return await projectDb.getRepoAutomationPolicy(repoShortName);
  } catch {
    return null;
  }
}

function getGitHubErrorDetails(err: unknown): {
  status: number | undefined;
  githubMessage: unknown;
  githubErrors: unknown;
  message: string;
} {
  if (axios.isAxiosError(err)) {
    return {
      status: err.response?.status,
      githubMessage: err.response?.data?.message,
      githubErrors: err.response?.data?.errors,
      message: err.message,
    };
  }
  return {
    status: undefined,
    githubMessage: undefined,
    githubErrors: undefined,
    message: err instanceof Error ? err.message : 'Unknown error',
  };
}

function parseGitHubRepoTarget(repoFullName: string): GitHubRepoTarget | null {
  if (!GITHUB_REPO_FULL_NAME_PATTERN.test(repoFullName)) {
    return null;
  }

  const [owner, repo] = repoFullName.split('/');
  if (!owner || !repo) {
    return null;
  }

  return {
    owner,
    repo,
    pullsUrl: new URL(`/repos/${owner}/${repo}/pulls`, 'https://api.github.com').toString(),
  };
}

async function createPullRequest({ repoFullName, fixBranch, baseBranch, context }: { repoFullName: string; fixBranch: string; baseBranch?: string; context: PRContext }): Promise<{ prUrl: string | null; prNumber: number | null }> {
  const { title, body } = buildPullRequestContent(context);
  const headers = {
    Authorization: `Bearer ${process.env['GITHUB_TOKEN']}`,
    Accept:        'application/vnd.github+json',
  };
  const base = baseBranch || 'main';
  const repoTarget = parseGitHubRepoTarget(repoFullName);
  if (!repoTarget) {
    logger.error({ repoFullName }, 'Refusing to create PR for invalid GitHub repo target');
    return { prUrl: null, prNumber: null };
  }

  const repoShortName = context.repoName || repoTarget.repo;

  try {
    const policyState = await loadRepoPolicy(repoShortName);
    const existing = await getExistingPullRequest(repoTarget, fixBranch, base, headers);
    if (existing) {
      if (policyState && !policyState.policy.allowPrUpdate) {
        logger.warn({ repoFullName, fixBranch, base }, 'Repo policy blocks updating an existing PR');
        return { prUrl: null, prNumber: null };
      }
      logger.info({ prUrl: existing.html_url, prNumber: existing.number }, 'PR already exists — skipping creation');
      return { prUrl: existing.html_url, prNumber: existing.number };
    }

    if (policyState && !policyState.policy.allowPrOpen) {
      logger.warn({ repoFullName, fixBranch, base }, 'Repo policy blocks opening a new PR');
      return { prUrl: null, prNumber: null };
    }

    const res = await axios.post(
      repoTarget.pullsUrl,
      { title, body, head: fixBranch, base },
      { headers }
    );

    logger.info(
      { prUrl: res.data.html_url, prNumber: res.data.number },
      'Pull request created'
    );

    return {
      prUrl:    res.data.html_url,
      prNumber: res.data.number,
    };
  } catch (err: unknown) {
    const details = getGitHubErrorDetails(err);
    logger.error({
      err: details.message,
      status: details.status,
      githubMessage: details.githubMessage,
      githubErrors: details.githubErrors,
      repoFullName,
      fixBranch,
      base,
    }, 'Failed to create PR');
    return { prUrl: null, prNumber: null };
  }
}

export = { createPullRequest };
