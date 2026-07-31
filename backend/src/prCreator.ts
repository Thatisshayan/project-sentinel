import axios from 'axios';
import logger from './logger';

interface PRContext {
  projectName?: string;
  repoName?: string;
  commitSha?: string | null;
  attemptNumber?: number | null;
  buildProvider?: string;
  failureReason?: string | null;
  kind?: 'task' | 'fix';
}

async function createPullRequest({ repoFullName, fixBranch, baseBranch, context }: { repoFullName: string; fixBranch: string; baseBranch?: string; context: PRContext }): Promise<{ prUrl: string | null; prNumber: number | null }> {
  const { projectName, repoName, commitSha, attemptNumber,
          buildProvider, failureReason, kind } = context;

  const shortSha = (commitSha || '').substring(0, 7);
  const isTask   = kind === 'task';

  const title = isTask
    ? `feat(sentinel): ${failureReason || 'automated improvement batch'}`
    : `fix(sentinel): repair ${buildProvider} build failure — attempt ${attemptNumber}`;

  const body = isTask
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
      ].join('\n');

  const headers = {
    Authorization: `Bearer ${process.env['GITHUB_TOKEN']}`,
    Accept:        'application/vnd.github+json',
  };
  const base = baseBranch || 'main';

  try {
    const existingRes = await axios.get(
      `https://api.github.com/repos/${repoFullName}/pulls`,
      {
        headers,
        params: {
          head:  `${repoFullName.split('/')[0]}:${fixBranch}`,
          base,
          state: 'open',
        },
      }
    );
    if (existingRes.data.length > 0) {
      const existing = existingRes.data[0];
      logger.info({ prUrl: existing.html_url, prNumber: existing.number }, 'PR already exists — skipping creation');
      return { prUrl: existing.html_url, prNumber: existing.number };
    }

    const res = await axios.post(
      `https://api.github.com/repos/${repoFullName}/pulls`,
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
  } catch (err: any) {
    const status = err.response?.status;
    const errBody = err.response?.data;
    logger.error({
      err: err.message,
      status,
      githubMessage: errBody?.message,
      githubErrors:  errBody?.errors,
      repoFullName,
      fixBranch,
      base,
    }, 'Failed to create PR');
    return { prUrl: null, prNumber: null };
  }
}

export = { createPullRequest };
