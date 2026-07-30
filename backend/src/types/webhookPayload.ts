// Normalized shape returned by extractPayload.ts's extractPayload() —
// the GitHub push-webhook payload boiled down to what the rest of the
// codebase actually consumes. Standalone module because extractPayload.ts
// uses `export =`.

export interface WebhookPayload {
  repoName: string;
  repoNameLower: string;
  repoFullName: string;
  repoUrl: string;
  ref: string;
  branchName: string;
  commitSha: string;
  commitMessage: string;
  commitUrl: string;
  commitTimestamp: string;
  authorName: string;
  authorEmail: string;
  addedFiles: string[];
  modifiedFiles: string[];
  removedFiles: string[];
  changedFiles: string[];
  changedFilesText: string;
  filesChangedCount: number;
  isMarketingOnlyUpdate: boolean;
  riskLevel: string;
  pusherName: string;
  commitCount: number;
  // Set by processWebhook.ts once the matching Notion project is resolved —
  // not part of extractPayload()'s own return.
  projectName?: string;
  notionPageId?: string;
}
