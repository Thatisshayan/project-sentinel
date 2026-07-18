"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("./logger"));
async function createPullRequest({ repoFullName, fixBranch, baseBranch, context }) {
    const { projectName, repoName, commitSha, attemptNumber, buildProvider, failureReason, kind } = context;
    const shortSha = (commitSha || '').substring(0, 7);
    const isTask = kind === 'task';
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
        Accept: 'application/vnd.github+json',
    };
    const base = baseBranch || 'main';
    try {
        const existingRes = await axios_1.default.get(`https://api.github.com/repos/${repoFullName}/pulls`, {
            headers,
            params: {
                head: `${repoFullName.split('/')[0]}:${fixBranch}`,
                base,
                state: 'open',
            },
        });
        if (existingRes.data.length > 0) {
            const existing = existingRes.data[0];
            logger_1.default.info({ prUrl: existing.html_url, prNumber: existing.number }, 'PR already exists — skipping creation');
            return { prUrl: existing.html_url, prNumber: existing.number };
        }
        const res = await axios_1.default.post(`https://api.github.com/repos/${repoFullName}/pulls`, { title, body, head: fixBranch, base }, { headers });
        logger_1.default.info({ prUrl: res.data.html_url, prNumber: res.data.number }, 'Pull request created');
        return {
            prUrl: res.data.html_url,
            prNumber: res.data.number,
        };
    }
    catch (err) {
        const status = err.response?.status;
        const errBody = err.response?.data;
        logger_1.default.error({
            err: err.message,
            status,
            githubMessage: errBody?.message,
            githubErrors: errBody?.errors,
            repoFullName,
            fixBranch,
            base,
        }, 'Failed to create PR');
        return { prUrl: null, prNumber: null };
    }
}
module.exports = { createPullRequest };
//# sourceMappingURL=prCreator.js.map