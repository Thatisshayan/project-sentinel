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
import { acquireNvidiaKey, nvidiaPoolSize } from '../utils/nvidiaKeyPool';

const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

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
  /**
   * Optional — invoked with the provider name that actually served the
   * request, right before callAnyProvider() returns successfully. Lets a
   * caller record real provider attribution (e.g. auditDb.ts's
   * audit_cycles.audit_agent, which previously hardcoded 'nvidia'
   * regardless of which provider in the fallback chain actually handled
   * it) without changing this function's return type for every other
   * caller that doesn't care which provider won.
   */
  onProviderUsed?: (provider: string) => void;
}

export interface ParsedJsonResponse<T> {
  raw: string;
  cleaned: string;
  parsed: T;
}

export interface ParsedJsonArrayResponse<T> {
  raw: string;
  cleaned: string;
  parsed: T[];
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

// NVIDIA is handled separately from this list (see callAnyProvider) since it
// draws from a pool of possibly-several keys (utils/nvidiaKeyPool.ts) rather
// than one static env var like the providers below.
function buildOtherProviders(models: ProviderModels): Provider[] {
  const dashscopeBase = process.env['DASHSCOPE_BASE_URL'] || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  return [
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
  const res    = await client.messages.create(
    {
      model,
      max_tokens: opts.maxTokens ?? 1000,
      ...(opts.systemPrompt ? { system: opts.systemPrompt } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      messages: [{ role: 'user', content: opts.userPrompt }],
    },
    { timeout: opts.timeoutMs ?? 30000 }
  );
  const block = res.content[0];
  return (block && block.type === 'text' ? block.text : '') || '';
}

/**
 * True unless AI_PROVIDER_CALLS_ENABLED is explicitly set to a falsy value
 * ('false'/'0'/''). Defaults to enabled so existing deployments that already
 * rely on provider keys being present don't silently go dark on upgrade —
 * set AI_PROVIDER_CALLS_ENABLED=false to hard-disable billable calls even
 * when provider keys are configured (e.g. a staging env sharing prod keys).
 */
function providerCallsEnabled(): boolean {
  const raw = process.env['AI_PROVIDER_CALLS_ENABLED'];
  return raw === undefined || !['false', '0', ''].includes(raw.toLowerCase());
}

/**
 * Walks the standard free-tier-first provider precedence, trying each
 * configured provider until one succeeds. A provider response is only
 * accepted if it returned non-empty content — an empty string is treated
 * as a failure so the loop moves on to the next provider instead of
 * silently returning nothing. Throws only if every configured provider
 * fails (or none are configured).
 */
export async function callAnyProvider(opts: CallAnyProviderOptions): Promise<string> {
  if (!providerCallsEnabled()) {
    throw new Error('AI provider calls disabled via AI_PROVIDER_CALLS_ENABLED');
  }

  const otherProviders = buildOtherProviders(opts.models || {}).filter((p) => p.key);
  const anthropicKey = opts.includeAnthropic ? process.env['ANTHROPIC_API_KEY'] : undefined;

  if (nvidiaPoolSize() === 0 && otherProviders.length === 0 && !anthropicKey) {
    throw new Error('No AI provider configured — set NVIDIA_API_KEY, GEMINI_API_KEY, DASHSCOPE_API_KEY, DEEPSEEK_API_KEY, or ANTHROPIC_API_KEY');
  }

  let lastErr: unknown;

  // NVIDIA first, same precedence as before — but drawn from the key pool
  // (utils/nvidiaKeyPool.ts) instead of a single static env var, so this
  // caller and every NVIDIA-keyed aider builder (builderRouter.ts) share
  // the same per-key concurrency cap instead of piling unboundedly onto
  // one account. If the pool is fully saturated, skip straight to the next
  // provider rather than blocking.
  if (nvidiaPoolSize() > 0) {
    const acquired = acquireNvidiaKey();
    if (acquired) {
      try {
        const model = opts.models?.nvidia || DEFAULT_MODELS.nvidia;
        const content = await callOpenAiCompatible(
          { name: 'NVIDIA NIM', key: acquired.key, url: NVIDIA_URL, model },
          opts
        );
        if (!content) throw new Error('empty response');
        opts.onProviderUsed?.('nvidia');
        return content;
      } catch (err: any) {
        lastErr = err;
        logger.warn({ provider: 'NVIDIA NIM', key: acquired.label, err: err.message }, 'AI provider failed — trying next');
      } finally {
        acquired.release();
      }
    } else {
      logger.warn('NVIDIA key pool at capacity — trying next provider');
    }
  }

  const PROVIDER_ID: Record<string, string> = {
    'Gemini':           'gemini',
    'DashScope (Qwen)': 'dashscope',
    'DeepSeek':         'deepseek',
  };

  for (const provider of otherProviders) {
    try {
      const content = await callOpenAiCompatible(provider, opts);
      if (!content) throw new Error('empty response');
      opts.onProviderUsed?.(PROVIDER_ID[provider.name] || provider.name);
      return content;
    } catch (err: any) {
      lastErr = err;
      logger.warn({ provider: provider.name, err: err.message }, 'AI provider failed — trying next');
    }
  }

  if (anthropicKey) {
    try {
      const content = await callAnthropic(anthropicKey, opts);
      if (!content) throw new Error('empty response');
      opts.onProviderUsed?.('claude');
      return content;
    } catch (err: any) {
      lastErr = err;
      logger.warn({ provider: 'Anthropic', err: err.message }, 'AI provider failed — trying next');
    }
  }

  throw lastErr;
}

export function stripThinkBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

export function extractJsonObject<T>(text: string): ParsedJsonResponse<T> {
  const cleaned = stripThinkBlocks(text).replace(/```json?|```/g, '').trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON object found in provider response');
  }

  let parsed: T;
  try {
    parsed = JSON.parse(jsonMatch[0]) as T;
  } catch (err) {
    throw new Error(`Failed to parse provider JSON: ${(err as Error).message}`);
  }

  return {
    raw: text,
    cleaned,
    parsed,
  };
}

export function extractJsonArray<T>(text: string): ParsedJsonArrayResponse<T> {
  const cleaned = stripThinkBlocks(text).replace(/```json?|```/g, '').trim();
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!arrMatch) {
    throw new Error('No JSON array found in provider response');
  }

  let parsed: T[];
  try {
    parsed = JSON.parse(arrMatch[0]) as T[];
  } catch (err) {
    throw new Error(`Failed to parse provider JSON array: ${(err as Error).message}`);
  }

  return {
    raw: text,
    cleaned,
    parsed,
  };
}
