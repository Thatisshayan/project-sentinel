import logger from './logger';
import projectDb from './projectDb';

/**
 * D-025 (docs/governance/DEFERRED_WORK.md): decoupled from the real Notion
 * API — this module now delegates to projectDb.ts's self-hosted Postgres
 * registry. Kept as a thin shim under the original name/signatures so the
 * 8 files that import it (repoOnboarder.ts, telegramAI.ts, telegramCommands.ts,
 * sprintOrchestrator.ts, priorityEngine.ts, debugOrchestrator.ts,
 * auditOrchestrator.ts, parallelExecutor.ts) needed zero changes.
 */

async function findNotionProject(repoName: string): ReturnType<typeof projectDb.findProject> {
  return projectDb.findProject(repoName);
}

async function updateNotionProject(pageId: string, data: Parameters<typeof projectDb.updateProject>[1]): Promise<void> {
  return projectDb.updateProject(pageId, data);
}

async function appendChangelog(pageId: string, data: Parameters<typeof projectDb.appendProjectChangelog>[1]): Promise<void> {
  return projectDb.appendProjectChangelog(pageId, data);
}

async function updateBuilderAgent(pageId: string, agentId: string): Promise<void> {
  return projectDb.updateProjectBuilderAgent(pageId, agentId);
}

async function createNotionProject(data: { repoName: string; priority?: string; builderAgent?: string }): Promise<string | null> {
  return projectDb.createProject(data);
}

function bustNotionCache(): void {
  // No-op — projectDb reads straight from Postgres, no page-list cache to bust.
  logger.debug('bustNotionCache called — no-op under self-hosted project registry');
}

export = {
  findNotionProject, updateNotionProject, appendChangelog,
  updateBuilderAgent, createNotionProject, bustNotionCache,
};
