import { config } from '../config.js';

export async function checkVercel(vercelProjectName, commitSha) {
  const headers = {
    Authorization: `Bearer ${config.vercel.token}`,
    'Content-Type': 'application/json',
  };

  try {
    let url;
    if (vercelProjectName) {
      url = `https://api.vercel.com/v1/deployments?project=${vercelProjectName}&limit=5`;
    } else {
      url = `https://api.vercel.com/v1/deployments?limit=5`;
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
      return { provider: 'Vercel', status: 'not_configured' };
    }

    const data = await res.json();
    const deployments = data.deployments || [];

    if (commitSha) {
      const match = deployments.find(d => d.meta?.githubCommitSha === commitSha);
      if (match) {
        return {
          provider: 'Vercel',
          status: normalizeVercelStatus(match.state),
          projectName: match.name,
          deploymentUrl: match.url,
          inspectUrl: match.inspectorUrl || `https://vercel.com/${match.owner?.username || ''}/${match.name}/${match.uid}`,
          commitSha: match.meta?.githubCommitSha || '',
          failureReason: match.error?.message || '',
        };
      }
    }

    const latest = deployments[0];
    if (latest) {
      return {
        provider: 'Vercel',
        status: normalizeVercelStatus(latest.state),
        projectName: latest.name,
        deploymentUrl: latest.url,
        inspectUrl: latest.inspectorUrl || '',
        commitSha: latest.meta?.githubCommitSha || '',
        failureReason: latest.error?.message || '',
      };
    }

    return { provider: 'Vercel', status: 'not_configured' };
  } catch (err) {
    return { provider: 'Vercel', status: 'unknown', error: err.message };
  }
}

function normalizeVercelStatus(state) {
  switch (state) {
    case 'READY': return 'success';
    case 'ERROR':
    case 'FAILED': return 'failed';
    case 'BUILDING':
    case 'QUEUED':
    case 'INITIALIZING':
    case 'CANCELED': return 'pending';
    default: return 'unknown';
  }
}
