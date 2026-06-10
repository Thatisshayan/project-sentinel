import { config } from '../config.js';

export async function checkVercel(vercelProjectName, commitSha) {
  const token = config.vercel.token;
  if (!token) return { provider: 'Vercel', status: 'not_configured' };

  try {
    const params = vercelProjectName ? `?project=${vercelProjectName}&limit=5` : '?limit=5';
    const res = await fetch(`https://api.vercel.com/v1/deployments${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) return { provider: 'Vercel', status: 'not_configured' };

    const data = await res.json();
    const deployments = data.deployments || [];

    if (commitSha) {
      for (const d of deployments) {
        const depId = d.uid;
        const depRes = await fetch(`https://api.vercel.com/v1/deployments/${depId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (depRes.ok) {
          const depData = await depRes.json();
          if (depData.meta?.githubCommitSha === commitSha) {
            return {
              provider: 'Vercel',
              status: normalizeVercelStatus(d.readyState || depData.readyState),
              projectName: d.name,
              deploymentUrl: d.url ? `https://${d.url}` : '',
              inspectUrl: d.inspectorUrl || '',
              failureReason: depData.error?.message || '',
            };
          }
        }
      }
    }

    const latest = deployments[0];
    if (!latest) return { provider: 'Vercel', status: 'not_configured' };

    return {
      provider: 'Vercel',
      status: normalizeVercelStatus(latest.readyState),
      projectName: latest.name,
      deploymentUrl: latest.url ? `https://${latest.url}` : '',
      inspectUrl: latest.inspectorUrl || '',
    };
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
