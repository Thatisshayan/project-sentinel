import { assessRisk, isMarketingOnly } from './riskAssessor';
import type { WebhookPayload } from './types/webhookPayload';

export interface GitHubPushCommit {
  id?: string;
  url?: string;
  timestamp?: string;
  message?: string;
  author?: { name?: string; email?: string };
  added?: string[];
  modified?: string[];
  removed?: string[];
}

// GitHub's push webhook payload, narrowed to the fields this file actually
// reads — deliberately loose/optional throughout since this is untrusted
// external input, not a shape we control.
export interface GitHubPushPayload {
  repository?: { name?: string; full_name?: string; html_url?: string };
  ref?: string;
  commits?: GitHubPushCommit[];
  head_commit?: GitHubPushCommit;
  pusher?: { name?: string };
}

function extractPayload(payload: GitHubPushPayload): WebhookPayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload is null or not an object');
  }

  const repo = payload.repository;
  if (!repo || !repo.name) {
    throw new Error('Payload missing repository.name');
  }

  const repoName       = repo.name;
  const repoNameLower  = repoName.toLowerCase();
  const repoFullName   = repo.full_name   || repoName;
  const repoUrl        = repo.html_url    || '';

  const ref        = payload.ref || '';
  const branchName = ref.replace('refs/heads/', '').replace('refs/tags/', '');

  const commits = Array.isArray(payload.commits) ? payload.commits : [];
  const commit  = payload.head_commit || commits[commits.length - 1] || null;

  if (!commit) {
    throw new Error('Payload has no commit data in head_commit or commits[]');
  }

  const commitSha       = commit.id        || '';
  const commitUrl       = commit.url       || '';
  const commitTimestamp = commit.timestamp || new Date().toISOString();
  const commitMessage   = ((commit.message || '').split('\n')[0] || '').substring(0, 200);

  const authorName  = (commit.author  && commit.author.name)  || (payload.pusher && payload.pusher.name) || 'Unknown';
  const authorEmail = (commit.author  && commit.author.email) || '';

  const addedFiles: string[]    = Array.isArray(commit.added)    ? commit.added    : [];
  const modifiedFiles: string[] = Array.isArray(commit.modified) ? commit.modified : [];
  const removedFiles: string[]  = Array.isArray(commit.removed)  ? commit.removed  : [];
  const changedFiles: string[]  = [...addedFiles, ...modifiedFiles, ...removedFiles];

  const filesChangedCount = changedFiles.length;
  const changedFilesText  = changedFiles.length === 0
    ? 'No files listed'
    : changedFiles.slice(0, 30).join(', ') +
      (changedFiles.length > 30 ? ` (+${changedFiles.length - 30} more)` : '');

  const riskLevel            = assessRisk(changedFiles);
  const isMarketingOnlyUpdate = isMarketingOnly(changedFiles);

  const pusherName  = (payload.pusher && payload.pusher.name) || authorName;
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

export = { extractPayload };
