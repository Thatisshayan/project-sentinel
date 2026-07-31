// Shared OpenAI-compatible provider fallback chain (D-005). Walks the
// standard free-tier-first precedence — NVIDIA NIM, Gemini, DashScope
// (Qwen), DeepSeek, and (opt-in only) Anthropic — trying each configured
// provider in turn until one returns content, matching the pattern
// sentinelBrain.ts already used in production before this module existed.
//
// Provider-specific post-processing (JSON parsing, <think>-block stripping)
// intentionally stays in the caller, not here — see D-005.
import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';
import logger from '../logger';

export interface ProviderModels {
  nvidia?: string;
  gemini?: string;
  dashscope?: string;
  deepseek?: string;
  anthropic?: string;
}

export interface CallAnyProviderOptions {
  userPrompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  models?: ProviderModels;
  /** Anthropic is never used unless explicitly opted in — free providers first. */
  includeAnthropic?: boolean;
}

const DEFAULT_MODELS: Required<Omit<ProviderModels, 'anthropic'>> & { anthropic: string } = {
  nvidia:    'mistralai/mistral-nemotron',
  gemini:    'gemini-2.0-flash',
  dashscope: 'qwen-max',
  deepseek:  'deepseek-chat',
  anthropic: 'claude-sonnet-4-6',
};

interface Provider {
  name: string;
  key: string | undefined;
  url: string;
  model: string;
}

function buildProviders(models: ProviderModels): Provider[] {
  const dashscopeBase = process.env['DASHSCOPE_BASE_URL'] || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  return [
    { name: 'NVIDIA NIM',        key: process.env['NVIDIA_API_KEY'],   url: 'https://integrate.api.nvidia.com/v1/chat/completions',                     model: models.nvidia    || DEFAULT_MODELS.nvidia },
    { name: 'Gemini',            key: process.env['GEMINI_API_KEY'],   url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: models.gemini    || DEFAULT_MODELS.gemini },
    { name: 'DashScope (Qwen)',  key: process.env['DASHSCOPE_API_KEY'], url: `${dashscopeBase}/chat/completions`,                                        model: models.dashscope || DEFAULT_MODELS.dashscope },
    { name: 'DeepSeek',          key: process.env['DEEPSEEK_API_KEY'], url: 'https://api.deepseek.com/chat/completions',                                model: models.deepseek  || DEFAULT_MODELS.deepseek },
  ];
}

async function callOpenAiCompatible(provider: Provider, opts: CallAnyProviderOptions): Promise<string> {
  const messages = opts.systemPrompt
    ? [{ role: 'system', content: opts.systemPrompt }, { role: 'user', content: opts.userPrompt }]
    : [{ role: 'user', content: opts.userPrompt }];

  const body: Record<string, unknown> = {
    model: provider.model,
    messages,
    max_tokens: opts.maxTokens ?? 1000,
  };
  if (opts.temperature !== undefined) {
    body['temperature'] = opts.temperature;
  }

  const res = await axios.post(provider.url, body, {
    headers: { Authorization: `Bearer ${provider.key}`, 'Content-Type': 'application/json' },
    timeout: opts.timeoutMs ?? 30000,
  });
  return res.data.choices[0]?.message?.content || '';
}

async function callAnthropic(apiKey: string, opts: CallAnyProviderOptions): Promise<string> {
  const model  = opts.models?.anthropic || DEFAULT_MODELS.anthropic;
  const client = new Anthropic({ apiKey });
  const res    = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 1000,
    ...(opts.systemPrompt ? { system: opts.systemPrompt } : {}),
    messages: [{ role: 'user', content: opts.userPrompt }],
  });
  const block = res.content[0];
  return (block && block.type === 'text' ? block.text : '') || '';
}

/**
 * Walks the standard free-tier-first provider precedence, trying each
 * configured provider until one succeeds. Throws only if every configured
 * provider fails (or none are configured).
 */
export async function callAnyProvider(opts: CallAnyProviderOptions): Promise<string> {
  const providers = buildProviders(opts.models || {}).filter((p) => p.key);
  const anthropicKey = opts.includeAnthropic ? process.env['ANTHROPIC_API_KEY'] : undefined;

  if (providers.length === 0 && !anthropicKey) {
    throw new Error('No AI provider configured — set NVIDIA_API_KEY, GEMINI_API_KEY, DASHSCOPE_API_KEY, DEEPSEEK_API_KEY, or ANTHROPIC_API_KEY');
  }

  let lastErr: unknown;
  for (const provider of providers) {
    try {
      return await callOpenAiCompatible(provider, opts);
    } catch (err: any) {
      lastErr = err;
      logger.warn({ provider: provider.name, err: err.message }, 'AI provider failed — trying next');
    }
  }

  if (anthropicKey) {
    try {
      return await callAnthropic(anthropicKey, opts);
    } catch (err: any) {
      lastErr = err;
      logger.warn({ provider: 'Anthropic', err: err.message }, 'AI provider failed — trying next');
    }
  }

  throw lastErr;
}
