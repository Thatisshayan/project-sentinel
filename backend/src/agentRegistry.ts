import logger from './logger';
import { registerAgent, setAgentWorking, setAgentIdle, getActiveAgents } from './agentDb';
import { getBuilderConfig, hasConfiguredKey } from './builderRouter';
import { broadcastToAll } from './agentRoom';

// IDs must match real entries in builderRouter.ts's BUILDERS map. This pool
// previously listed qwen_coder / qwen_coder_dash / qwen_max / qwen_turbo /
// deepseek — providers dropped from builderRouter.ts on 2026-07-29 (see its
// header comment). getBuilderConfig() silently maps any *unrecognized* id to
// the default ('nvidia') builder rather than throwing, so those five stale
// ids were quietly registering as duplicate "nvidia" agents under fake
// names/labels — each with its own maxConcurrent slot (totaling ~19 phantom
// slots) that selectAgent()'s activeCounts bookkeeping never actually
// tracked, since getActiveAgents() only sees rows this file registers. Net
// effect: nothing gated how many of those phantom agents could run at once
// against the one real, rate-limited NVIDIA_API_KEY they all secretly
// shared — a plausible root cause for aider calls timing out / the key
// intermittently looking "invalid" under load. Real distinct providers only
// below. NVIDIA-key entries' maxConcurrent is deliberately modest at this
// bookkeeping layer — the real cross-caller cap now lives in
// utils/nvidiaKeyPool.ts (NVIDIA_API_KEY may be backed by several keys;
// each gets its own concurrency slot there), shared between these agents'
// aider calls and ai/client.ts's separate NVIDIA usage. This layer's numbers
// just need to not wildly exceed the pool's total real capacity.
const AGENT_POOL = [
  // { id: 'claude', priority: 1, maxConcurrent: 2 },  // re-add when ANTHROPIC_API_KEY is set
  { id: 'nvidia',            priority: 1, maxConcurrent: 3 }, // NVIDIA_API_KEY pool
  { id: 'gpt_oss_120b',      priority: 2, maxConcurrent: 2 }, // NVIDIA_API_KEY pool
  { id: 'gemini',            priority: 2, maxConcurrent: 2 }, // GEMINI_API_KEY — distinct provider
  { id: 'mistral_codestral', priority: 3, maxConcurrent: 2 }, // MISTRAL_API_KEY — distinct provider
  { id: 'openrouter_gemma',  priority: 3, maxConcurrent: 2 }, // OPENROUTER_API_KEY — distinct provider
  { id: 'llama_8b',          priority: 4, maxConcurrent: 2 }, // NVIDIA_API_KEY pool
];

async function initAgentPool(): Promise<void> {
  let registered = 0;
  for (const agent of AGENT_POOL) {
    const config = getBuilderConfig(agent.id);
    // getBuilderConfig() falls back to the default builder for an
    // unrecognized id instead of failing — catch that here so a typo'd or
    // since-removed pool entry doesn't silently register as a mislabeled
    // duplicate of the default builder (see comment above AGENT_POOL).
    if (config.id !== agent.id) {
      logger.warn({ poolId: agent.id, resolvedTo: config.id }, 'AGENT_POOL entry does not match a known builder — skipping');
      continue;
    }
    if (!hasConfiguredKey(config)) continue;
    await registerAgent(agent.id, config.label);
    registered++;
  }
  await broadcastToAll(`Agent pool initialised — ${registered} agents registered`);
  logger.info({ registered }, 'Agent pool initialised');
}

async function selectAgent(taskComplexity: string, preferredBuilder?: string): Promise<string> {
  if (preferredBuilder) {
    const config = getBuilderConfig(preferredBuilder);
    if (config && hasConfiguredKey(config)) {
      return preferredBuilder;
    }
  }

  const active = await getActiveAgents();
  const activeCounts: Record<string, number> = {};
  active.forEach((a) => {
    activeCounts[a.agent_id] = (activeCounts[a.agent_id] || 0) + 1;
  });

  const complexityPreference: Record<string, string[]> = {
    low:      ['llama_8b', 'gpt_oss_120b', 'nvidia', 'gemini'],
    medium:   ['gpt_oss_120b', 'nvidia', 'mistral_codestral', 'gemini'],
    high:     ['nvidia', 'gemini', 'mistral_codestral', 'openrouter_gemma'],
  };

  const preferred = complexityPreference[taskComplexity] || complexityPreference['medium'] || [];

  for (const agentId of preferred) {
    const poolEntry = AGENT_POOL.find(a => a.id === agentId);
    if (!poolEntry) continue;

    const currentCount = activeCounts[agentId] || 0;
    if (currentCount < poolEntry.maxConcurrent) {
      const config = getBuilderConfig(agentId);
      if (hasConfiguredKey(config)) {
        return agentId;
      }
    }
  }

  for (const poolEntry of AGENT_POOL) {
    const currentCount = activeCounts[poolEntry.id] || 0;
    if (currentCount < poolEntry.maxConcurrent) {
      const config = getBuilderConfig(poolEntry.id);
      if (hasConfiguredKey(config)) {
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
