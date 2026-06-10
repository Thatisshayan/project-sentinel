import { config } from '../config.js';

export async function checkGitHubActions(owner, repo, commitSha) {
  const token = config.github.token;
  if (!token) return { provider: 'GitHub Actions', status: 'not_configured' };

  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' };

  try {
    const statusRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${commitSha}/status`, { headers });
    if (!statusRes.ok) return { provider: 'GitHub Actions', status: 'not_configured' };

    const statusData = await statusRes.json();
    const state = statusData.state || 'unknown';

    const suitesRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${commitSha}/check-suites`, { headers });
    const suites = suitesRes.ok ? (await suitesRes.json()).check_suites || [] : [];

    const status = state === 'success' ? 'success' : state === 'failure' ? 'failed' : 'pending';

    return {
      provider: 'GitHub Actions',
      status,
      state,
      details: suites.map(s => ({ name: s.app?.name || '?', conclusion: s.conclusion || s.status })),
      url: statusData.target_url || (suites[0]?.html_url) || '',
    };
  } catch (err) {
    return { provider: 'GitHub Actions', status: 'unknown', error: err.message };
  }
}
