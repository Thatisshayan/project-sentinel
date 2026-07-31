// Payload shapes for queueClient.ts's BullMQ job producers. Standalone
// module because queueClient.ts uses `export =`.

export interface BuildCheckJobData {
  projectName?: string;
  repoName: string;
  repoFullName: string;
  branchName: string;
  commitSha: string;
  commitUrl?: string;
  commitMessage?: string;
  authorName?: string;
  changedFiles?: string[];
  topicId?: number | null;
  attemptNumber?: number;
}

export interface DebugJobData {
  repoFullName: string;
  commitSha: string;
  attemptNumber: number;
  [key: string]: unknown;
}
