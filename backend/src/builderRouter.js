const logger = require('./logger');

const DASHSCOPE_BASE = process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';

// NVIDIA NIM requires the full provider/model name in the model field
// (e.g. "qwen/qwen2.5-coder-32b-instruct", not just "qwen2.5-coder-32b-instruct").
// Aider uses the 'openai/' prefix to force the OpenAI client, and passes
// everything after that prefix as the model name to the custom API base.
// So 'openai/qwen/qwen2.5-coder-32b-instruct' sends model="qwen/qwen2.5-coder-32b-instruct"
// to NVIDIA NIM, which is exactly what the API expects.
function toNvidiaModel(rawName) {
  // Already in openai/provider/model format — leave as-is
  if (rawName.startsWith('openai/')) return rawName;
  // Already has provider prefix (e.g. 'nvidia/llama-...') — just add openai/
  return `openai/${rawName}`;
}

const BUILDERS = {
  nvidia: {
    id:          'nvidia',
    label:       'NVIDIA NIM — Llama 3.1 70B',
    type:        'openai_compatible',
    // nemotron-70b is a reasoning model that emits <think> blocks — aider cannot
    // parse those as SEARCH/REPLACE diffs.  Default to llama-3.1-70b-instruct
    // which is a plain instruction model that produces clean diffs.
    // NVIDIA_MODEL can still override but must NOT be set to nemotron for aider tasks.
    aiderModel:  toNvidiaModel(process.env.NVIDIA_MODEL || 'meta/llama-3.1-70b-instruct'),
    apiBase:     'https://integrate.api.nvidia.com/v1',
    envKey:      'NVIDIA_API_KEY',
    description: 'NVIDIA NIM — Llama 3.1 70B instruction model',
  },
  qwen_coder: {
    id:          'qwen_coder',
    label:       'Llama 3.3 70B (NVIDIA NIM)',
    type:        'openai_compatible',
    // qwen/qwen2.5-coder-32b-instruct reached EOL 2026-05-12 on NVIDIA NIM (HTTP 410).
    // Using meta/llama-3.3-70b-instruct — strong instruction-following model,
    // reliably produces aider SEARCH/REPLACE diff blocks.
    aiderModel:  'openai/meta/llama-3.3-70b-instruct',
    apiBase:     'https://integrate.api.nvidia.com/v1',
    envKey:      'NVIDIA_API_KEY',
    description: 'Meta Llama 3.3 70B on NVIDIA NIM — primary code builder',
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
};

const DEFAULT_BUILDER = 'qwen_coder';

// Ordered fallback chain when a builder fails.
// Both qwen_coder and nvidia now use NVIDIA NIM; if NIM is down both will fail
// together, so fallbacks prefer DashScope then Gemini then DeepSeek.
const FALLBACK_CHAIN = {
  nvidia:          ['qwen_coder_dash', 'gemini', 'deepseek', 'qwen_coder'],
  qwen_coder:      ['qwen_coder_dash', 'gemini', 'deepseek', 'nvidia'],
  qwen_coder_dash: ['qwen_coder',      'gemini', 'deepseek'],
  gemini:          ['qwen_coder_dash', 'qwen_coder', 'deepseek'],
  qwen_max:        ['qwen_coder_dash', 'qwen_coder', 'deepseek'],
  qwen_plus:       ['qwen_max',        'qwen_coder_dash', 'deepseek'],
  qwen_turbo:      ['qwen_coder_dash', 'qwen_coder',      'deepseek'],
  llama_fast:      ['qwen_coder',      'qwen_coder_dash',  'deepseek'],
  deepseek:        ['qwen_coder_dash', 'qwen_coder', 'gemini'],
  opencode:        ['qwen_coder'],
};

function getFallbackBuilder(failedBuilder) {
  const chain = FALLBACK_CHAIN[failedBuilder] || ['nvidia'];
  for (const candidate of chain) {
    const config = BUILDERS[candidate];
    if (config && (!config.envKey || process.env[config.envKey])) {
      return candidate;
    }
  }
  return null;
}

function getBuilderConfig(assignment) {
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

function getAiderEnv(config) {
  const env = { ...process.env };
  switch (config.id) {
    case 'gemini':
      env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
      break;
    case 'nvidia':
    case 'qwen_coder':
    case 'llama_fast':
      env.OPENAI_API_KEY  = process.env.NVIDIA_API_KEY || '';
      env.OPENAI_API_BASE = 'https://integrate.api.nvidia.com/v1';
      env.OPENAI_BASE_URL = 'https://integrate.api.nvidia.com/v1';
      break;
    case 'qwen_max':
    case 'qwen_plus':
    case 'qwen_coder_dash':
    case 'qwen_turbo':
      env.OPENAI_API_KEY  = process.env.DASHSCOPE_API_KEY || '';
      env.OPENAI_API_BASE = DASHSCOPE_BASE;
      break;
    case 'deepseek':
      env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
      env.OPENAI_API_BASE  = 'https://api.deepseek.com';
      env.OPENAI_API_KEY   = process.env.DEEPSEEK_API_KEY || '';
      break;
  }
  return env;
}

function listBuilders() {
  return Object.values(BUILDERS).map(b => ({
    id:          b.id,
    label:       b.label,
    configured:  b.envKey ? !!process.env[b.envKey] : true,
    description: b.description,
  }));
}

module.exports = { getBuilderConfig, getAiderEnv, listBuilders, getFallbackBuilder };
