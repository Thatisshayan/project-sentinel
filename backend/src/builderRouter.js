const logger = require('./logger');

const BUILDERS = {
  claude: {
    id:          'claude',
    label:       'Claude Code',
    type:        'claude_code',
    envKey:      'ANTHROPIC_API_KEY',
    description: 'Anthropic subscription — primary builder for all Phase 3',
  },
  gemini: {
    id:          'gemini',
    label:       'Aider + Gemini 2.5 Pro',
    type:        'aider',
    aiderModel:  'gemini/gemini-2.5-pro',
    envKey:      'GEMINI_API_KEY',
    description: 'Google free tier — solid quality fallback',
  },
  qwen: {
    id:          'qwen',
    label:       'Aider + Qwen Max (DashScope)',
    type:        'aider',
    aiderModel:  'openai/qwen-max',
    apiBase:     'https://dashscope.aliyuncs.com/compatible-mode/v1',
    envKey:      'DASHSCOPE_API_KEY',
    description: 'Alibaba Cloud — 1M free tokens per model',
  },
  hermes: {
    id:          'hermes',
    label:       'Aider + Hermes',
    type:        'aider',
    aiderModel:  'openai/hermes-3-llama-3.1-405b',
    apiBase:     'https://openrouter.ai/api/v1',
    envKey:      'HERMES_API_KEY',
    description: 'NousResearch Hermes — excellent instruction following',
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

const DEFAULT_BUILDER = 'claude';

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
      'Builder API key missing — falling back to claude');
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
    case 'qwen':
      env.OPENAI_API_KEY  = process.env.DASHSCOPE_API_KEY || '';
      env.OPENAI_API_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
      break;
    case 'hermes':
      env.OPENAI_API_KEY  = process.env.HERMES_API_KEY || '';
      env.OPENAI_API_BASE = 'https://openrouter.ai/api/v1';
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
