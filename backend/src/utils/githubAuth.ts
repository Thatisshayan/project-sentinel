export function getGithubToken(): string | null {
  const token = process.env['GITHUB_TOKEN']?.trim();
  return token ? token : null;
}

export function requireGithubToken(context: string): string {
  const token = getGithubToken();
  if (!token) {
    throw new Error(`GITHUB_TOKEN is required for ${context}`);
  }
  return token;
}

export function buildGithubCloneUrl(repoFullName: string, context: string): string {
  const token = requireGithubToken(context);
  return `https://${token}@github.com/${repoFullName}.git`;
}
