const logger = require('./logger');

const BUILDERS = {
  // claude: {
  //   id:          'claude',
  //   label:       'Claude Code',
  //   type:        'claude_code',
  //   envKey:      'ANTHROPIC_API_KEY',
  //   description: 'Anthropic — primary builder',
  // },
  nvidia: {
    id:          'nvidia',
    label:       'NVIDIA NIM — Nemotron 70B',
    type:        'openai_compatible',
    aiderModel:  process.env.NVIDIA_MODEL || 'nvidia/llama-3.1-nemotron-70b-instruct',
    apiBase:     'https://integrate.api.nvidia.com/v1',
    envKey:      'NVIDIA_API_KEY',
    description: 'NVIDIA NIM — best free reasoning model',
  },
  qwen_coder: {
    id:          'qwen_coder',
    label:       'Qwen 2.5 Coder 32B (NVIDIA)',
    type:        'openai_compatible',
    aiderModel:  'qwen/qwen2.5-coder-32b-instruct',
    apiBase:     'https://integrate.api.nvidia.com/v1',
    envKey:      'NVIDIA_API_KEY',
    description: 'Best free code model for building tasks',
  },
  llama_fast: {
    id:          'llama_fast',
    label:       'Llama 3.1 8B (NVIDIA)',
    type:        'openai_compatible',
    aiderModel:  'meta/llama-3.1-8b-instruct',
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
    aiderModel:  'qwen-max',
    apiBase:     'https://dashscope.aliyuncs.com/compatible-mode/v1',
    envKey:      'DASHSCOPE_API_KEY',
    description: 'Alibaba best — strongest reasoning',
  },
  qwen_plus: {
    id:          'qwen_plus',
    label:       'Qwen Plus (DashScope)',
    type:        'openai_compatible',
    aiderModel:  'qwen-plus',
    apiBase:     'https://dashscope.aliyuncs.com/compatible-mode/v1',
    envKey:      'DASHSCOPE_API_KEY',
    description: 'Alibaba balanced — good quality, fast',
  },
  qwen_coder_dash: {
    id:          'qwen_coder_dash',
    label:       'Qwen 2.5 Coder (DashScope)',
    type:        'openai_compatible',
    aiderModel:  'qwen2.5-coder-32b-instruct',
    apiBase:     'https://dashscope.aliyuncs.com/compatible-mode/v1',
    envKey:      'DASHSCOPE_API_KEY',
    description: 'Alibaba code specialist for building tasks',
  },
  qwen_turbo: {
    id:          'qwen_turbo',
    label:       'Qwen Turbo (DashScope)',
    type:        'openai_compatible',
    aiderModel:  'qwen-turbo',
    apiBase:     'https://dashscope.aliyuncs.com/compatible-mode/v1',
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

const DEFAULT_BUILDER = 'nvidia';

function getBuilderConfig(assignment) {
  const key    = (assignment || DEFAULT_BUILDER).toLowerCase().trim();
  const config = BUILDERS[key];

  if (!config) {
    logger.warn({ assignment, fallback: DEFAULT_BUILDER },
      'Unknown builder assignment — using default');
    return BUILDERS[DEFAULT_BUILDER];
  }

  if (config.envKey && !process.env[config.envKey]) {
    logger.warn({ builder: key, envKey: config.envKey, fallback: DEFAULT_BUILDER },
      'Builder API key missing — falling back to nvidia');
    return BUILDERS[DEFAULT_BUILDER];
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
      break;
    case 'qwen_max':
    case 'qwen_plus':
    case 'qwen_coder_dash':
    case 'qwen_turbo':
      env.OPENAI_API_KEY  = process.env.DASHSCOPE_API_KEY || '';
      env.OPENAI_API_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
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

module.exports = { getBuilderConfig, getAiderEnv, listBuilders };
