const axios  = require('axios');
const logger = require('./logger');

async function createPullRequest({ repoFullName, fixBranch, baseBranch, context }) {
  const { projectName, repoName, commitSha, attemptNumber,
          buildProvider, failureReason } = context;

  const shortSha = (commitSha || '').substring(0, 7);

  const title = `fix(sentinel): repair ${buildProvider} build failure — attempt ${attemptNumber}`;

  const body = [
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

  try {
    const res = await axios.post(
      `https://api.github.com/repos/${repoFullName}/pulls`,
      {
        title,
        body,
        head: fixBranch,
        base: baseBranch || 'main',
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept:        'application/vnd.github+json',
        },
      }
    );

    logger.info(
      { prUrl: res.data.html_url, prNumber: res.data.number },
      'Pull request created'
    );

    return {
      prUrl:    res.data.html_url,
      prNumber: res.data.number,
    };
  } catch (err) {
    const status = err.response?.status;
    const data = err.response?.data;
    logger.error({ err: err.message, status, data, repoFullName }, 'Failed to create PR');
    return { prUrl: null, prNumber: null };
  }
}

module.exports = { createPullRequest };
