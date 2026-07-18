"use strict";
const riskAssessor_1 = require("./riskAssessor");
function extractPayload(payload) {
    if (!payload || typeof payload !== 'object') {
        throw new Error('Payload is null or not an object');
    }
    const repo = payload.repository;
    if (!repo || !repo.name) {
        throw new Error('Payload missing repository.name');
    }
    const repoName = repo.name;
    const repoNameLower = repoName.toLowerCase();
    const repoFullName = repo.full_name || repoName;
    const repoUrl = repo.html_url || '';
    const ref = payload.ref || '';
    const branchName = ref.replace('refs/heads/', '').replace('refs/tags/', '');
    const commits = Array.isArray(payload.commits) ? payload.commits : [];
    const commit = payload.head_commit || commits[commits.length - 1] || null;
    if (!commit) {
        throw new Error('Payload has no commit data in head_commit or commits[]');
    }
    const commitSha = commit.id || '';
    const commitUrl = commit.url || '';
    const commitTimestamp = commit.timestamp || new Date().toISOString();
    const commitMessage = ((commit.message || '').split('\n')[0]).substring(0, 200);
    const authorName = (commit.author && commit.author.name) || (payload.pusher && payload.pusher.name) || 'Unknown';
    const authorEmail = (commit.author && commit.author.email) || '';
    const addedFiles = Array.isArray(commit.added) ? commit.added : [];
    const modifiedFiles = Array.isArray(commit.modified) ? commit.modified : [];
    const removedFiles = Array.isArray(commit.removed) ? commit.removed : [];
    const changedFiles = [...addedFiles, ...modifiedFiles, ...removedFiles];
    const filesChangedCount = changedFiles.length;
    const changedFilesText = changedFiles.length === 0
        ? 'No files listed'
        : changedFiles.slice(0, 30).join(', ') +
            (changedFiles.length > 30 ? ` (+${changedFiles.length - 30} more)` : '');
    const riskLevel = (0, riskAssessor_1.assessRisk)(changedFiles);
    const isMarketingOnlyUpdate = (0, riskAssessor_1.isMarketingOnly)(changedFiles);
    const pusherName = (payload.pusher && payload.pusher.name) || authorName;
    const commitCount = commits.length || 1;
    return {
        repoName,
        repoNameLower,
        repoFullName,
        repoUrl,
        ref,
        branchName,
        commitSha,
        commitMessage,
        commitUrl,
        commitTimestamp,
        authorName,
        authorEmail,
        addedFiles,
        modifiedFiles,
        removedFiles,
        changedFiles,
        changedFilesText,
        filesChangedCount,
        isMarketingOnlyUpdate,
        riskLevel,
        pusherName,
        commitCount,
    };
}
module.exports = { extractPayload };
//# sourceMappingURL=extractPayload.js.map