function getGithubOrg() {
  const org = process.env.GITHUB_ORG?.trim();
  if (!org) throw new Error('GITHUB_ORG env var is required');
  return org;
}

function repoFullName(repoName) {
  return `${getGithubOrg()}/${repoName}`;
}

module.exports = { getGithubOrg, repoFullName };
