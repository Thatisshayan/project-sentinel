export function parsePushEvent(payload) {
  const repo = payload.repository || {};
  const repoName = repo.name || '';
  const repoFullName = repo.full_name || '';
  const repoUrl = repo.html_url || '';

  const ref = payload.ref || '';
  const branchName = ref.replace('refs/heads/', '');

  const headCommit = payload.head_commit || (payload.commits && payload.commits[payload.commits.length - 1]) || {};

  const commitHash = headCommit.id || '';
  const commitMessage = (headCommit.message || '').split('\n')[0];
  const commitUrl = headCommit.url || '';
  const authorName = headCommit.author?.name || payload.pusher?.name || '';
  const authorEmail = headCommit.author?.email || payload.pusher?.email || '';
  const commitTimestamp = headCommit.timestamp || '';
  const pusherName = payload.pusher?.name || '';
  const pusherEmail = payload.pusher?.email || '';

  const added = headCommit.added || [];
  const modified = headCommit.modified || [];
  const removed = headCommit.removed || [];
  const changedFiles = [...added, ...modified, ...removed];
  const filesChangedCount = changedFiles.length;

  return {
    repoName,
    repoNameLower: repoName.toLowerCase(),
    repoFullName,
    repoUrl,
    branchName,
    ref,
    commitMessage,
    commitHash,
    commitUrl,
    authorName,
    authorEmail,
    commitTimestamp,
    changedFiles,
    changedFilesText: changedFiles.join(', '),
    filesChangedCount,
    addedFiles: added,
    modifiedFiles: modified,
    removedFiles: removed,
    commitCount: (payload.commits || []).length,
    pusherName,
    pusherEmail,
  };
}

const HIGH_RISK_KEYWORDS = [
  'secret', 'token', '.env', 'auth', 'password', 'payment', 'billing',
  'stripe', 'database', 'migration', 'destructive', 'force push',
  'history rewrite', 'branch protection',
];

export function detectHighRiskChange(event) {
  const message = (event.commitMessage || '').toLowerCase();
  const files = (event.changedFilesText || '').toLowerCase();

  const combined = message + ' ' + files;
  const matched = HIGH_RISK_KEYWORDS.filter(k => combined.includes(k.toLowerCase()));

  if (matched.length > 0) {
    return { isHighRisk: true, matchedKeywords: matched };
  }
  return { isHighRisk: false, matchedKeywords: [] };
}
