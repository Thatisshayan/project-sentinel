"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSuccessMessage = buildSuccessMessage;
exports.buildUnknownRepoMessage = buildUnknownRepoMessage;
exports.buildErrorMessage = buildErrorMessage;
function buildSuccessMessage(data, changelogAppended) {
    const { projectName, repoName, branchName, commitMessage, authorName, filesChangedCount, isMarketingOnlyUpdate, commitUrl, riskLevel, commitSha, } = data;
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
//# sourceMappingURL=messages.js.map