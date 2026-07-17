function getGithubOrg(): string {
  const org = process.env['GITHUB_ORG']?.trim();
  if (!org) throw new Error('GITHUB_ORG env var is required');
  return org;
}

function repoFullName(repoName: string): string {
  return `${getGithubOrg()}/${repoName}`;
}

function canonicalizeRepoName(input: string): { repoName: string; repoFullName: string } | null {
  if (!input) return null;
  // lazy require — portfolioAnalytics requires this module for repoFullName()
  const { REPO_LIST } = require('./portfolioAnalytics') as { REPO_LIST: Array<{ repoName: string; repoFullName: string }> };
  const ALL_REPOS = [...REPO_LIST, { repoName: 'project-sentinel', repoFullName: repoFullName('project-sentinel') }];
  const normalize = (s: string): string => s.toLowerCase().replace(/[-_\s]/g, '');
  const inputNorm = normalize(input);
  return ALL_REPOS.find((r: { repoName: string }) => normalize(r.repoName) === inputNorm) || null;
}

export = { getGithubOrg, repoFullName, canonicalizeRepoName };
