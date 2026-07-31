// Shapes shared between aiderRunner.ts's cloneAndFix() and its callers
// (debugOrchestrator.ts). Standalone module because aiderRunner.ts uses
// `export =`.

export interface AiderContext {
  failureReason?: string;
  failureLogs?: string;
  changedFiles?: string[];
  buildProvider?: string;
  attemptNumber?: number;
  repoFullName?: string;
  repoName?: string;
  branchName?: string;
  projectMemoryText?: string;
  projectName?: string;
  buildUrl?: string | null;
  commitSha?: string;
}

export interface CloneResult {
  status: string;
  reason?: string;
  fixBranch?: string;
  aiderOutput?: string;
  commitSha?: string;
  commitMessage?: string;
  filesChanged?: string[];
}
