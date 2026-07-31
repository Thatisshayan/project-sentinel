import logger from './logger';
import { registerAgent, setAgentWorking, setAgentIdle, getActiveAgents } from './agentDb';
import { getBuilderConfig } from './builderRouter';
import { broadcastToAll } from './agentRoom';

const AGENT_POOL = [
  // { id: 'claude', priority: 1, maxConcurrent: 2 },  // re-add when ANTHROPIC_API_KEY is set
  { id: 'nvidia',          priority: 1, maxConcurrent: 3 },
  { id: 'qwen_coder',      priority: 2, maxConcurrent: 3 },
  { id: 'qwen_coder_dash', priority: 3, maxConcurrent: 3 },
  { id: 'gemini',          priority: 3, maxConcurrent: 2 },
  { id: 'qwen_max',        priority: 3, maxConcurrent: 2 },
  { id: 'llama_fast',      priority: 4, maxConcurrent: 5 },
  { id: 'qwen_turbo',      priority: 4, maxConcurrent: 5 },
  { id: 'deepseek',        priority: 4, maxConcurrent: 3 },
];

async function initAgentPool(): Promise<void> {
  let registered = 0;
  for (const agent of AGENT_POOL) {
    const config = getBuilderConfig(agent.id);
    if (config.envKey && !process.env[config.envKey]) continue;
    await registerAgent(agent.id, config.label);
    registered++;
  }
  await broadcastToAll(`Agent pool initialised — ${registered} agents registered`);
  logger.info({ registered }, 'Agent pool initialised');
}

async function selectAgent(taskComplexity: string, preferredBuilder?: string): Promise<string> {
  if (preferredBuilder) {
    const config = getBuilderConfig(preferredBuilder);
    if (config && (!config.envKey || process.env[config.envKey])) {
      return preferredBuilder;
    }
  }

  const active = await getActiveAgents();
  const activeCounts: Record<string, number> = {};
  active.forEach((a) => {
    activeCounts[a.agent_id] = (activeCounts[a.agent_id] || 0) + 1;
  });

  const complexityPreference: Record<string, string[]> = {
    low:      ['llama_fast', 'qwen_turbo', 'qwen_coder', 'nvidia'],
    medium:   ['qwen_coder', 'nvidia', 'qwen_coder_dash', 'gemini'],
    high:     ['nvidia', 'qwen_max', 'qwen_coder', 'gemini'],
  };

  const preferred = complexityPreference[taskComplexity] || complexityPreference['medium'] || [];

  for (const agentId of preferred) {
    const poolEntry = AGENT_POOL.find(a => a.id === agentId);
    if (!poolEntry) continue;

    const currentCount = activeCounts[agentId] || 0;
    if (currentCount < poolEntry.maxConcurrent) {
      const config = getBuilderConfig(agentId);
      if (!config.envKey || process.env[config.envKey]) {
        return agentId;
      }
    }
  }

  for (const poolEntry of AGENT_POOL) {
    const currentCount = activeCounts[poolEntry.id] || 0;
    if (currentCount < poolEntry.maxConcurrent) {
      const config = getBuilderConfig(poolEntry.id);
      if (!config.envKey || process.env[config.envKey]) {
        return poolEntry.id;
      }
    }
  }

  logger.warn('No available agents — all at capacity');
  return AGENT_POOL[0]!.id;
}

async function assignAgent(agentId: string, taskData: { repoFullName: string; taskType: string; taskId: number; taskTitle: string }): Promise<void> {
  await setAgentWorking(agentId, taskData);
}

async function freeAgent(agentId: string, success = true): Promise<void> {
  await setAgentIdle(agentId, success);
}

export = {
  initAgentPool,
  selectAgent,
  assignAgent,
  freeAgent,
};
