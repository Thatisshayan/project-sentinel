export function buildSuccessMessage(data: any, changelogAppended: boolean): string {
  const {
    projectName, repoName, branchName, commitMessage,
    authorName, filesChangedCount, isMarketingOnlyUpdate,
    commitUrl, riskLevel, commitSha,
  } = data;

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

export function buildUnknownRepoMessage(data: any): string {
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

export function buildErrorMessage(context: string, repoName: string, detail: any): string {
  return [
    `Project Sentinel error ❌`,
    ``,
    `Repo: ${repoName}`,
    `Problem: ${context}`,
    `Detail: ${String(detail).substring(0, 300)}`,
  ].join('\n');
}
