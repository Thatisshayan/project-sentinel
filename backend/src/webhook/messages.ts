import type { WebhookPayload } from '../types/webhookPayload';

export function buildSuccessMessage(data: WebhookPayload, changelogAppended: boolean): string {
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

export function buildUnknownRepoMessage(data: WebhookPayload): string {
  const { repoName, branchName, commitMessage } = data;

  return [
    `🆕 New repo pushed to: ${repoName}`,
    ``,
    `I don't have this one set up yet, so I skipped it — nothing was lost.`,
    ``,
    `To start tracking it, reply:`,
    `/sentinel repos scan`,
    `(this scans GitHub and adds any new repos automatically)`,
    ``,
    `Branch: ${branchName}`,
    `Latest commit: ${commitMessage}`,
  ].join('\n');
}

export function buildErrorMessage(context: string, repoName: string, detail: unknown): string {
  return [
    `Project Sentinel error ❌`,
    ``,
    `Repo: ${repoName}`,
    `Problem: ${context}`,
    `Detail: ${String(detail).substring(0, 300)}`,
  ].join('\n');
}
