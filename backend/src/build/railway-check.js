import { config } from '../config.js';

const API = config.railway.apiUrl;
const HEADERS = {
  Authorization: `Bearer ${config.railway.token}`,
  'Content-Type': 'application/json',
};

export async function checkRailway(commitSha) {
  try {
    const query = {
      query: `{ projects { edges { node { id name services { edges { node { id name } } } } } } }`,
    };
    const res = await fetch(API, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(query),
    });
    if (!res.ok) return { provider: 'Railway', status: 'not_configured' };

    const data = await res.json();
    const projects = data.data?.projects?.edges || [];

    if (projects.length === 0) return { provider: 'Railway', status: 'not_configured' };

    for (const project of projects) {
      const services = project.node?.services?.edges || [];
      for (const service of services) {
        const depQuery = {
          query: `query($serviceId: String!) { deployments(serviceId: $serviceId, first: 5) { edges { node { id status createdAt meta } } } }`,
          variables: { serviceId: service.node.id },
        };
        const depRes = await fetch(API, {
          method: 'POST',
          headers: HEADERS,
          body: JSON.stringify(depQuery),
        });
        if (!depRes.ok) continue;

        const depData = await depRes.json();
        const deployments = depData.data?.deployments?.edges || [];

        if (commitSha) {
          const match = deployments.find(d => d.node?.meta?.commitSha === commitSha);
          if (match) {
            return {
              provider: 'Railway',
              status: normalizeRailwayStatus(match.node.status),
              projectName: project.node.name,
              serviceName: service.node.name,
              deploymentUrl: `https://railway.app/project/${project.node.id}/service/${service.node.id}`,
              commitSha: match.node.meta?.commitSha || '',
              failureReason: '',
            };
          }
        }

        if (deployments.length > 0) {
          const latest = deployments[0].node;
          return {
            provider: 'Railway',
            status: normalizeRailwayStatus(latest.status),
            projectName: project.node.name,
            serviceName: service.node.name,
            deploymentUrl: `https://railway.app/project/${project.node.id}/service/${service.node.id}`,
            commitSha: latest.meta?.commitSha || '',
            failureReason: '',
          };
        }
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
