import { config } from '../config.js';

export async function checkGitHubActions(owner, repo, commitSha) {
  const headers = {
    Authorization: `Bearer ${config.github.token}`,
    Accept: 'application/vnd.github.v3+json',
  };

  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/commits/${commitSha}/check-suites`;
    const res = await fetch(url, { headers });

    if (!res.ok) {
      if (res.status === 403 || res.status === 404) {
        return { provider: 'GitHub Actions', status: 'not_configured' };
      }
      return { provider: 'GitHub Actions', status: 'unknown', error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const suites = data.check_suites || [];

    if (suites.length === 0) {
      const statusRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${commitSha}/status`, { headers });
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        const state = statusData.state || 'unknown';
        return {
          provider: 'GitHub Actions',
          status: state === 'success' ? 'success' : state === 'failure' ? 'failed' : 'pending',
          state,
          url: statusData.target_url || '',
        };
      }
      return { provider: 'GitHub Actions', status: 'not_configured' };
    }

    const conclusions = suites.map(s => s.conclusion || s.status);
    const allSuccess = conclusions.every(c => c === 'success');
    const anyFailed = conclusions.some(c => c === 'failure' || c === 'cancelled' || c === 'timed_out');
    const anyPending = conclusions.some(c => c === 'pending' || c === 'queued' || c === 'in_progress');

    return {
      provider: 'GitHub Actions',
      status: allSuccess ? 'success' : anyFailed ? 'failed' : anyPending ? 'pending' : 'unknown',
      suites: suites.map(s => ({ name: s.app?.name || '', conclusion: s.conclusion || s.status, url: s.html_url || '' })),
    };
  } catch (err) {
    return { provider: 'GitHub Actions', status: 'unknown', error: err.message };
  }
}
