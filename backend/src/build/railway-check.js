import { config } from '../config.js';

const API = 'https://backboard.railway.com/graphql/v2';

export async function checkRailway(commitSha) {
  const token = config.railway.apiToken || config.railway.token;
  if (!token) return { provider: 'Railway', status: 'not_configured' };

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  try {
    const projRes = await fetch(API, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: '{ projects { edges { node { id name } } } }' }),
    });

    if (!projRes.ok) return { provider: 'Railway', status: 'not_configured' };
    const projData = await projRes.json();
    if (projData.errors) return { provider: 'Railway', status: 'not_configured' };

    const projects = projData.data?.projects?.edges || [];

    for (const project of projects) {
      const depRes = await fetch(API, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: `{ deployments(input: {projectId: "${project.node.id}"}) { edges { node { id status meta } } } }`,
        }),
      });

      if (!depRes.ok) continue;
      const depData = await depRes.json();
      const deployments = depData.data?.deployments?.edges || [];

      if (commitSha) {
        for (const dep of deployments) {
          if (dep.node.meta?.commitHash === commitSha) {
            return {
              provider: 'Railway',
              status: normalizeRailwayStatus(dep.node.status),
              projectName: project.node.name,
              deploymentUrl: `https://railway.app/project/${project.node.id}`,
              failureReason: dep.node.status === 'FAILED' ? 'Deployment failed' : '',
            };
          }
        }
      }

      if (deployments.length > 0) {
        const latest = deployments[0].node;
        return {
          provider: 'Railway',
          status: normalizeRailwayStatus(latest.status),
          projectName: project.node.name,
          deploymentUrl: `https://railway.app/project/${project.node.id}`,
          failureReason: latest.status === 'FAILED' ? 'Deployment failed' : '',
        };
      }
    }

    return { provider: 'Railway', status: 'not_configured' };
  } catch (err) {
    return { provider: 'Railway', status: 'unknown', error: err.message };
  }
}

function normalizeRailwayStatus(status) {
  switch (status) {
    case 'SUCCESS': return 'success';
    case 'FAILED':
    case 'CRASHED':
    case 'REMOVED': return 'failed';
    case 'QUEUED':
    case 'BUILDING':
    case 'DEPLOYING':
    case 'WAITING':
    case 'SLEEPING': return 'pending';
    case 'CANCELLED':
    case 'SKIPPED': return 'cancelled';
    default: return 'unknown';
  }
}
