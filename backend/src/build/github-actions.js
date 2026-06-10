import { config } from '../config.js';

export async function checkGitHubActions(owner, repo, commitSha) {
  const token = config.github.token;
  if (!token) return { provider: 'GitHub Actions', status: 'not_configured' };

  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' };

  try {
    const statusRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${commitSha}/status`, { headers });
    if (!statusRes.ok) return { provider: 'GitHub Actions', status: 'not_configured' };

    const statusData = await statusRes.json();
    let state = statusData.state || 'unknown';

    if (state === 'pending' || state === 'unknown') {
      const runsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs?head_sha=${commitSha}&per_page=5`, { headers });
      if (runsRes.ok) {
        const runsData = await runsRes.json();
        const runs = runsData.workflow_runs || [];
        if (runs.length > 0) {
          const anyFailed = runs.some(r => r.conclusion === 'failure' || r.conclusion === 'cancelled' || r.conclusion === 'timed_out');
          const anyRunning = runs.some(r => r.status === 'in_progress' || r.status === 'queued' || r.status === 'pending');
          const allSuccess = runs.every(r => r.conclusion === 'success');
          state = anyFailed ? 'failure' : allSuccess ? 'success' : anyRunning ? 'pending' : state;
        }
      }
    }

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
