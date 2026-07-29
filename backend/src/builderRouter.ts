import logger from './logger';
import { buildChildEnv } from './utils/childEnv';

const NVIDIA_BASE = 'https://integrate.api.nvidia.com/v1';

interface BuilderConfig {
  id: string;
  label: string;
  type: string;
  aiderModel?: string;
  editFormat?: string;
  apiBase?: string;
  envKey?: string;
  description: string;
}

/**
 * Every entry below (except gemini/opencode) was verified live against
 * https://integrate.api.nvidia.com/v1/chat/completions on 2026-07-29 —
 * this account's key returns 200 for these specific model IDs (many
 * catalog entries return 404 "Function not found for account" despite
 * being listed in /v1/models, so listing alone doesn't mean entitled).
 * DashScope/Qwen, DeepSeek-direct and Claude Code were dropped per Shayan's
 * request (2026-07-29) in favor of a wider NVIDIA-hosted pool. Reasoning
 * models (the nemotron family, mistral-nemotron) are deliberately excluded
 * here too — that family's <think>-block output is exactly what was
 * breaking aider's diff/whole-file parsing and causing repeated build
 * failures before this pass; every model below is a plain instruction
 * model with no reasoning preamble.
 */
const BUILDERS: Record<string, BuilderConfig> = {
  nvidia: {
    id:          'nvidia',
    label:       'Llama 3.1 70B (NVIDIA NIM)',
    type:        'openai_compatible',
    aiderModel:  'openai/meta/llama-3.1-70b-instruct',
    apiBase:     NVIDIA_BASE,
    envKey:      'NVIDIA_API_KEY',
    description: 'Primary code builder — largest verified-working instruct model on this key',
  },
  llama_8b: {
    id:          'llama_8b',
    label:       'Llama 3.1 8B (NVIDIA NIM)',
    type:        'openai_compatible',
    aiderModel:  'openai/meta/llama-3.1-8b-instruct',
    apiBase:     NVIDIA_BASE,
    envKey:      'NVIDIA_API_KEY',
    description: 'Fast fallback for low-complexity tasks',
  },
  llama_3b: {
    id:          'llama_3b',
    label:       'Llama 3.2 3B (NVIDIA NIM)',
    type:        'openai_compatible',
    aiderModel:  'openai/meta/llama-3.2-3b-instruct',
    apiBase:     NVIDIA_BASE,
    envKey:      'NVIDIA_API_KEY',
    description: 'Small/fast — bulk low-complexity tasks',
  },
  llama_1b: {
    id:          'llama_1b',
    label:       'Llama 3.2 1B (NVIDIA NIM)',
    type:        'openai_compatible',
    aiderModel:  'openai/meta/llama-3.2-1b-instruct',
    apiBase:     NVIDIA_BASE,
    envKey:      'NVIDIA_API_KEY',
    description: 'Smallest/fastest fallback — last resort before non-NVIDIA providers',
  },
  gpt_oss_120b: {
    id:          'gpt_oss_120b',
    label:       'GPT-OSS 120B (NVIDIA NIM)',
    type:        'openai_compatible',
    aiderModel:  'openai/openai/gpt-oss-120b',
    apiBase:     NVIDIA_BASE,
    envKey:      'NVIDIA_API_KEY',
    description: 'OpenAI open-weight model hosted on NVIDIA NIM — strong general coding ability',
  },
  gpt_oss_20b: {
    id:          'gpt_oss_20b',
    label:       'GPT-OSS 20B (NVIDIA NIM)',
    type:        'openai_compatible',
    aiderModel:  'openai/openai/gpt-oss-20b',
    apiBase:     NVIDIA_BASE,
    envKey:      'NVIDIA_API_KEY',
    description: 'Smaller/faster GPT-OSS variant',
  },
  minimax: {
    id:          'minimax',
    label:       'MiniMax M3 (NVIDIA NIM)',
    type:        'openai_compatible',
    aiderModel:  'openai/minimaxai/minimax-m3',
    apiBase:     NVIDIA_BASE,
    envKey:      'NVIDIA_API_KEY',
    description: 'Additional NVIDIA-hosted model for pool diversity',
  },
  gemini: {
    id:          'gemini',
    label:       'Aider + Gemini 2.5 Flash',
    type:        'aider',
    aiderModel:  'gemini/gemini-2.5-flash',
    envKey:      'GEMINI_API_KEY',
    description: 'Only non-NVIDIA fallback — covers an NVIDIA NIM-wide outage. gemini-2.5-pro has 0 free-tier quota on this key; flash does not.',
  },
  opencode: {
    id:          'opencode',
    label:       'OpenCode',
    type:        'opencode',
    envKey:      'OPENCODE_API_KEY',
    description: 'OpenCode CLI — use for repos where preferred',
  },
};

const DEFAULT_BUILDER = 'nvidia';

// Every NVIDIA-hosted builder falls back through the rest of the NVIDIA
// pool first (cheap, same provider, fast to retry), then to Gemini as the
// only cross-provider option — covering the case where NVIDIA NIM itself
// is down rather than just one model being unavailable.
const NVIDIA_POOL = ['nvidia', 'llama_8b', 'llama_3b', 'llama_1b', 'gpt_oss_120b', 'gpt_oss_20b', 'minimax'];

function chainFor(builderId: string): string[] {
  const rest = NVIDIA_POOL.filter(id => id !== builderId);
  return [...rest, 'gemini'];
}

const FALLBACK_CHAIN: Record<string, string[]> = {
  nvidia:       chainFor('nvidia'),
  llama_8b:     chainFor('llama_8b'),
  llama_3b:     chainFor('llama_3b'),
  llama_1b:     chainFor('llama_1b'),
  gpt_oss_120b: chainFor('gpt_oss_120b'),
  gpt_oss_20b:  chainFor('gpt_oss_20b'),
  minimax:      chainFor('minimax'),
  gemini:       NVIDIA_POOL,
  opencode:     NVIDIA_POOL,
};

function getFallbackBuilder(failedBuilder: string): string | null {
  const chain = FALLBACK_CHAIN[failedBuilder] || NVIDIA_POOL;
  for (const candidate of chain) {
    const config = BUILDERS[candidate];
    if (config && (!config.envKey || process.env[config.envKey])) {
      return candidate;
    }
  }
  return null;
}

function getBuilderConfig(assignment?: string): BuilderConfig {
  const key    = (assignment || DEFAULT_BUILDER).toLowerCase().trim();
  const config = BUILDERS[key];

  if (!config) {
    logger.warn({ assignment, fallback: DEFAULT_BUILDER }, 'Unknown builder assignment — using default');
    return getBuilderConfig(DEFAULT_BUILDER);
  }

  if (config.envKey && !process.env[config.envKey]) {
    // Walk the FALLBACK_CHAIN to find the first builder with a valid key.
    // Do NOT fall back to BUILDERS[DEFAULT_BUILDER] unconditionally — if the
    // default itself has no key this creates an infinite loop.
    const chain = FALLBACK_CHAIN[key] || [];
    for (const candidate of chain) {
      const fb = BUILDERS[candidate];
      if (fb && (!fb.envKey || process.env[fb.envKey])) {
        logger.warn({ builder: key, envKey: config.envKey, fallback: candidate },
          'Builder API key missing — falling back');
        return fb;
      }
    }
    // No configured fallback found — return the requested config anyway and let
    // the caller surface the auth error via aider stderr.
    logger.warn({ builder: key, envKey: config.envKey }, 'Builder API key missing and no fallback available');
    return config;
  }

  return config;
}

function getAiderEnv(config: BuilderConfig): Record<string, string | undefined> {
  // Start from a scoped env (no full process.env leak) — see utils/childEnv.ts
  const env = buildChildEnv();
  switch (config.id) {
    case 'gemini':
      env['GEMINI_API_KEY'] = process.env['GEMINI_API_KEY'] || '';
      break;
    case 'nvidia':
    case 'llama_8b':
    case 'llama_3b':
    case 'llama_1b':
    case 'gpt_oss_120b':
    case 'gpt_oss_20b':
    case 'minimax':
      env['OPENAI_API_KEY']  = process.env['NVIDIA_API_KEY'] || '';
      env['OPENAI_API_BASE'] = NVIDIA_BASE;
      env['OPENAI_BASE_URL'] = NVIDIA_BASE;
      break;
  }
  return env;
}

function listBuilders(): Array<{ id: string; label: string; configured: boolean; description: string }> {
  return Object.values(BUILDERS).map(b => ({
    id:          b.id,
    label:       b.label,
    configured:  b.envKey ? !!process.env[b.envKey] : true,
    description: b.description,
  }));
}

export = { getBuilderConfig, getAiderEnv, listBuilders, getFallbackBuilder };
