import logger from './logger';

const DASHSCOPE_BASE = process.env['DASHSCOPE_BASE_URL'] || 'https://dashscope.aliyuncs.com/compatible-mode/v1';

// NVIDIA NIM requires the full provider/model name in the model field
// (e.g. "qwen/qwen2.5-coder-32b-instruct", not just "qwen2.5-coder-32b-instruct").
// Aider uses the 'openai/' prefix to force the OpenAI client, and passes
// everything after that prefix as the model name to the custom API base.
// So 'openai/qwen/qwen2.5-coder-32b-instruct' sends model="qwen/qwen2.5-coder-32b-instruct"
// to NVIDIA NIM, which is exactly what the API expects.
function toNvidiaModel(rawName: string): string {
  // Already in openai/provider/model format — leave as-is
  if (rawName.startsWith('openai/')) return rawName;
  // Already has provider prefix (e.g. 'nvidia/llama-...') — just add openai/
  return `openai/${rawName}`;
}

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

const BUILDERS: Record<string, BuilderConfig> = {
  nvidia: {
    id:          'nvidia',
    label:       'NVIDIA NIM — Llama 3.1 70B',
    type:        'openai_compatible',
    // nemotron-70b is a reasoning model that emits <think> blocks — aider cannot
    // parse those as SEARCH/REPLACE diffs.  Default to llama-3.1-70b-instruct
    // which is a plain instruction model that produces clean diffs.
    // NVIDIA_MODEL can still override but must NOT be set to nemotron for aider tasks.
    aiderModel:  toNvidiaModel(process.env['NVIDIA_MODEL'] || 'meta/llama-3.1-70b-instruct'),
    apiBase:     'https://integrate.api.nvidia.com/v1',
    envKey:      'NVIDIA_API_KEY',
    description: 'NVIDIA NIM — Llama 3.1 70B instruction model',
  },
  qwen_coder: {
    id:          'qwen_coder',
    label:       'Llama 3.1 70B (NVIDIA NIM)',
    type:        'openai_compatible',
    // qwen/qwen2.5-coder-32b-instruct reached EOL 2026-05-12 on NVIDIA NIM (HTTP 410).
    // Codestral (mistralai/codestral-22b-instruct-v0.1) and every other NIM
    // code-specialist model (deepseek-coder, granite-code, starcoder2) return
    // HTTP 404 "Function not found for account" on this key's entitlement tier
    // — verified directly against the NIM API, not just a naming issue.
    // Falling back to llama-3.1-70b-instruct, which this account can call.
    aiderModel:  'openai/meta/llama-3.1-70b-instruct',
    editFormat:  'diff',
    apiBase:     'https://integrate.api.nvidia.com/v1',
    envKey:      'NVIDIA_API_KEY',
    description: 'Llama 3.1 70B on NVIDIA NIM — primary code builder (Codestral not entitled on this key)',
  },
  llama_fast: {
    id:          'llama_fast',
    label:       'Llama 3.1 8B (NVIDIA)',
    type:        'openai_compatible',
    aiderModel:  'openai/meta/llama-3.1-8b-instruct',
    apiBase:     'https://integrate.api.nvidia.com/v1',
    envKey:      'NVIDIA_API_KEY',
    description: 'Ultra fast fallback for low complexity tasks',
  },
  gemini: {
    id:          'gemini',
    label:       'Aider + Gemini 2.5 Pro',
    type:        'aider',
    aiderModel:  'gemini/gemini-2.5-pro',
    editFormat:  'diff',
    envKey:      'GEMINI_API_KEY',
    description: 'Google free tier — solid quality fallback',
  },
  qwen_max: {
    id:          'qwen_max',
    label:       'Qwen Max (DashScope)',
    type:        'openai_compatible',
    aiderModel:  'openai/qwen-max',
    apiBase:     DASHSCOPE_BASE,
    envKey:      'DASHSCOPE_API_KEY',
    description: 'Alibaba best — strongest reasoning',
  },
  qwen_plus: {
    id:          'qwen_plus',
    label:       'Qwen Plus (DashScope)',
    type:        'openai_compatible',
    aiderModel:  'openai/qwen-plus',
    apiBase:     DASHSCOPE_BASE,
    envKey:      'DASHSCOPE_API_KEY',
    description: 'Alibaba balanced — good quality, fast',
  },
  qwen_coder_dash: {
    id:          'qwen_coder_dash',
    label:       'Qwen 2.5 Coder (DashScope)',
    type:        'openai_compatible',
    aiderModel:  'openai/qwen2.5-coder-32b-instruct',
    editFormat:  'diff',
    apiBase:     DASHSCOPE_BASE,
    envKey:      'DASHSCOPE_API_KEY',
    description: 'Alibaba code specialist for building tasks',
  },
  qwen_turbo: {
    id:          'qwen_turbo',
    label:       'Qwen Turbo (DashScope)',
    type:        'openai_compatible',
    aiderModel:  'openai/qwen-turbo',
    apiBase:     DASHSCOPE_BASE,
    envKey:      'DASHSCOPE_API_KEY',
    description: 'Alibaba fastest — bulk low complexity tasks',
  },
  deepseek: {
    id:          'deepseek',
    label:       'Aider + DeepSeek Coder',
    type:        'aider',
    aiderModel:  'deepseek/deepseek-coder',
    editFormat:  'diff',
    envKey:      'DEEPSEEK_API_KEY',
    description: 'Very cheap — routine low-complexity tasks',
  },
  opencode: {
    id:          'opencode',
    label:       'OpenCode',
    type:        'opencode',
    envKey:      'OPENCODE_API_KEY',
    description: 'OpenCode CLI — use for repos where preferred',
  },
  claude_code: {
    id:          'claude_code',
    label:       'Claude Code (Sonnet 4.6)',
    type:        'claude_code',
    envKey:      'ANTHROPIC_API_KEY',
    description: 'Claude Code CLI — uses Read/Edit/Bash tools, most reliable builder',
  },
};

const DEFAULT_BUILDER = 'qwen_coder';

// Ordered fallback chain when a builder fails.
  // Both qwen_coder and nvidia now use NVIDIA NIM; if NIM is down both will fail
  // together, so fallbacks prefer DashScope then Gemini then DeepSeek.
  // claude_code is the most reliable builder (uses real tools, not SEARCH/REPLACE diffs)
  // so it leads every chain when ANTHROPIC_API_KEY is configured.
  // nvidia is added as fallback for claude_code since it's free and uses different API.
  const FALLBACK_CHAIN: Record<string, string[]> = {
    nvidia:          ['claude_code', 'qwen_coder_dash', 'gemini', 'deepseek', 'qwen_coder'],
    qwen_coder:      ['claude_code', 'qwen_coder_dash', 'gemini', 'deepseek', 'nvidia'],
    qwen_coder_dash: ['claude_code', 'qwen_coder',      'gemini', 'deepseek'],
    gemini:          ['claude_code', 'qwen_coder_dash', 'qwen_coder', 'deepseek'],
    qwen_max:        ['claude_code', 'qwen_coder_dash', 'qwen_coder', 'deepseek'],
    qwen_plus:       ['claude_code', 'qwen_max',        'qwen_coder_dash', 'deepseek'],
    qwen_turbo:      ['claude_code', 'qwen_coder_dash', 'qwen_coder',      'deepseek'],
    llama_fast:      ['claude_code', 'qwen_coder',      'qwen_coder_dash',  'deepseek'],
    deepseek:        ['claude_code', 'qwen_coder_dash', 'qwen_coder', 'gemini'],
    opencode:        ['claude_code', 'qwen_coder'],
    claude_code:     ['nvidia', 'qwen_coder_dash', 'gemini', 'deepseek', 'qwen_coder'],
  };

function getFallbackBuilder(failedBuilder: string): string | null {
  const chain = FALLBACK_CHAIN[failedBuilder] || ['nvidia'];
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
  const env: Record<string, string | undefined> = { ...process.env };
  switch (config.id) {
    case 'gemini':
      env['GEMINI_API_KEY'] = process.env['GEMINI_API_KEY'] || '';
      break;
    case 'nvidia':
    case 'qwen_coder':
    case 'llama_fast':
      env['OPENAI_API_KEY']  = process.env['NVIDIA_API_KEY'] || '';
      env['OPENAI_API_BASE'] = 'https://integrate.api.nvidia.com/v1';
      env['OPENAI_BASE_URL'] = 'https://integrate.api.nvidia.com/v1';
      break;
    case 'qwen_max':
    case 'qwen_plus':
    case 'qwen_coder_dash':
    case 'qwen_turbo':
      env['OPENAI_API_KEY']  = process.env['DASHSCOPE_API_KEY'] || '';
      env['OPENAI_API_BASE'] = DASHSCOPE_BASE;
      break;
    case 'deepseek':
      env['DEEPSEEK_API_KEY'] = process.env['DEEPSEEK_API_KEY'] || '';
      env['OPENAI_API_BASE']  = 'https://api.deepseek.com';
      env['OPENAI_API_KEY']   = process.env['DEEPSEEK_API_KEY'] || '';
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
