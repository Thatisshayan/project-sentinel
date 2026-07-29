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
  reasoning?: boolean;
  description: string;
}

function nvidiaBuilder(id: string, label: string, model: string, opts: { reasoning?: boolean; description: string }): BuilderConfig {
  return {
    id, label,
    type:        'openai_compatible',
    aiderModel:  `openai/${model}`,
    apiBase:     NVIDIA_BASE,
    envKey:      'NVIDIA_API_KEY',
    reasoning:   opts.reasoning,
    description: opts.description,
  };
}

// Mistral and OpenRouter both have well-established native litellm/aider
// provider prefixes ('mistral/', 'openrouter/') and read their own env var
// by name (MISTRAL_API_KEY, OPENROUTER_API_KEY) — no NVIDIA-style base-URL
// override hack needed.
function mistralBuilder(id: string, label: string, model: string, opts: { reasoning?: boolean; description: string }): BuilderConfig {
  return {
    id, label,
    type:        'aider',
    aiderModel:  `mistral/${model}`,
    envKey:      'MISTRAL_API_KEY',
    reasoning:   opts.reasoning,
    description: opts.description,
  };
}

function openrouterBuilder(id: string, label: string, model: string, opts: { reasoning?: boolean; description: string }): BuilderConfig {
  return {
    id, label,
    type:        'aider',
    aiderModel:  `openrouter/${model}`,
    envKey:      'OPENROUTER_API_KEY',
    reasoning:   opts.reasoning,
    description: opts.description,
  };
}

/**
 * Every entry below (except gemini/opencode) was verified live against
 * https://integrate.api.nvidia.com/v1/chat/completions on 2026-07-29 — this
 * account's key returns 200 for these specific model IDs. Most of the wider
 * ~100-model catalog returns 404 "Function not found for account" despite
 * being listed in /v1/models, so listing alone doesn't mean entitled; these
 * are the ones actually confirmed callable.
 *
 * DashScope/Qwen, DeepSeek-direct and Claude Code were dropped per Shayan's
 * request (2026-07-29) in favor of a wider NVIDIA-hosted pool.
 *
 * `reasoning: true` marks the nemotron family (and mistral-nemotron) — these
 * emit a <think>...</think> preamble that has previously broken aider's
 * output parsing ("Nemotron failing a lot as builder"). They're kept in the
 * pool rather than excluded outright (per Shayan's ask for as deep a
 * fallback chain as possible), but ordered last, after every plain
 * instruction model — combined with taskBuilder.ts's "no commit = try next
 * builder" retry logic, a reasoning model producing unparseable output just
 * costs one wasted attempt, not a stuck pipeline.
 */
const BUILDERS: Record<string, BuilderConfig> = {
  nvidia: nvidiaBuilder('nvidia', 'Llama 3.1 70B (NVIDIA NIM)', 'meta/llama-3.1-70b-instruct',
    { description: 'Primary code builder — largest verified-working plain-instruct model on this key' }),
  llama_8b: nvidiaBuilder('llama_8b', 'Llama 3.1 8B (NVIDIA NIM)', 'meta/llama-3.1-8b-instruct',
    { description: 'Fast fallback for low-complexity tasks' }),
  llama_3b: nvidiaBuilder('llama_3b', 'Llama 3.2 3B (NVIDIA NIM)', 'meta/llama-3.2-3b-instruct',
    { description: 'Small/fast — bulk low-complexity tasks' }),
  llama_1b: nvidiaBuilder('llama_1b', 'Llama 3.2 1B (NVIDIA NIM)', 'meta/llama-3.2-1b-instruct',
    { description: 'Smallest/fastest plain-instruct fallback' }),
  gpt_oss_120b: nvidiaBuilder('gpt_oss_120b', 'GPT-OSS 120B (NVIDIA NIM)', 'openai/gpt-oss-120b',
    { description: 'OpenAI open-weight model hosted on NVIDIA NIM — strong general coding ability' }),
  gpt_oss_20b: nvidiaBuilder('gpt_oss_20b', 'GPT-OSS 20B (NVIDIA NIM)', 'openai/gpt-oss-20b',
    { description: 'Smaller/faster GPT-OSS variant' }),
  minimax: nvidiaBuilder('minimax', 'MiniMax M3 (NVIDIA NIM)', 'minimaxai/minimax-m3',
    { description: 'Additional NVIDIA-hosted general model' }),
  gemma_31b: nvidiaBuilder('gemma_31b', 'Gemma 4 31B (NVIDIA NIM)', 'google/gemma-4-31b-it',
    { description: 'Google open-weight model hosted on NVIDIA NIM' }),
  poolside: nvidiaBuilder('poolside', 'Poolside Laguna XS (NVIDIA NIM)', 'poolside/laguna-xs-2.1',
    { description: 'Poolside specializes in code models — worth trying even though editFormat is unverified' }),
  stepfun: nvidiaBuilder('stepfun', 'StepFun Step 3.7 Flash (NVIDIA NIM)', 'stepfun-ai/step-3.7-flash',
    { description: 'Additional NVIDIA-hosted general model' }),
  // ── reasoning-family (<think> preamble) — last resort, see header note ──
  nemotron_super_49b: nvidiaBuilder('nemotron_super_49b', 'Llama 3.3 Nemotron Super 49B (NVIDIA NIM)', 'nvidia/llama-3.3-nemotron-super-49b-v1',
    { reasoning: true, description: 'Reasoning model — last resort, may emit unparseable <think> preamble' }),
  nemotron_super_49b_v15: nvidiaBuilder('nemotron_super_49b_v15', 'Llama 3.3 Nemotron Super 49B v1.5 (NVIDIA NIM)', 'nvidia/llama-3.3-nemotron-super-49b-v1.5',
    { reasoning: true, description: 'Reasoning model — last resort, may emit unparseable <think> preamble' }),
  nemotron_3_super_120b: nvidiaBuilder('nemotron_3_super_120b', 'Nemotron 3 Super 120B (NVIDIA NIM)', 'nvidia/nemotron-3-super-120b-a12b',
    { reasoning: true, description: 'Reasoning model — last resort, may emit unparseable <think> preamble' }),
  nemotron_3_ultra_550b: nvidiaBuilder('nemotron_3_ultra_550b', 'Nemotron 3 Ultra 550B (NVIDIA NIM)', 'nvidia/nemotron-3-ultra-550b-a55b',
    { reasoning: true, description: 'Reasoning model — last resort, may emit unparseable <think> preamble' }),
  nemotron_mini: nvidiaBuilder('nemotron_mini', 'Nemotron Mini 4B (NVIDIA NIM)', 'nvidia/nemotron-mini-4b-instruct',
    { reasoning: true, description: 'Reasoning model — last resort, may emit unparseable <think> preamble' }),
  nemotron_3_nano_30b: nvidiaBuilder('nemotron_3_nano_30b', 'Nemotron 3 Nano 30B (NVIDIA NIM)', 'nvidia/nemotron-3-nano-30b-a3b',
    { reasoning: true, description: 'Reasoning model — last resort, may emit unparseable <think> preamble' }),
  nemotron_nano_9b: nvidiaBuilder('nemotron_nano_9b', 'NVIDIA Nemotron Nano 9B v2 (NVIDIA NIM)', 'nvidia/nvidia-nemotron-nano-9b-v2',
    { reasoning: true, description: 'Reasoning model — last resort, may emit unparseable <think> preamble' }),
  mistral_nemotron: nvidiaBuilder('mistral_nemotron', 'Mistral Nemotron (NVIDIA NIM)', 'mistralai/mistral-nemotron',
    { reasoning: true, description: 'Reasoning model — last resort, may emit unparseable <think> preamble' }),
  // ── Mistral La Plateforme (own free tier, own API key) — verified live 2026-07-29 ──
  mistral_codestral: mistralBuilder('mistral_codestral', 'Codestral (Mistral)', 'codestral-latest',
    { description: "Mistral's dedicated code-completion/editing model — real redundancy, different provider than NVIDIA/OpenRouter" }),
  mistral_small: mistralBuilder('mistral_small', 'Mistral Small (Mistral)', 'mistral-small-latest',
    { description: 'General-purpose Mistral model' }),
  mistral_large: mistralBuilder('mistral_large', 'Mistral Large (Mistral)', 'mistral-large-latest',
    { description: 'Mistral flagship model' }),
  // ── OpenRouter (own free tier, own API key) — verified live 2026-07-29 ──
  openrouter_gemma: openrouterBuilder('openrouter_gemma', 'Gemma 4 31B (OpenRouter)', 'google/gemma-4-31b-it:free',
    { description: 'Same model as gemma_31b but via OpenRouter — different provider/infra for real redundancy' }),
  openrouter_gpt_oss_20b: openrouterBuilder('openrouter_gpt_oss_20b', 'GPT-OSS 20B (OpenRouter)', 'openai/gpt-oss-20b:free',
    { reasoning: true, description: 'Reasoning-style output observed live — last resort' }),
  openrouter_north_mini: openrouterBuilder('openrouter_north_mini', 'Cohere North Mini Code (OpenRouter)', 'cohere/north-mini-code:free',
    { reasoning: true, description: 'Reasoning-style output observed live despite "code" in the name — last resort' }),
  openrouter_ling: openrouterBuilder('openrouter_ling', 'Ling 3.0 Flash (OpenRouter)', 'inclusionai/ling-3.0-flash:free',
    { reasoning: true, description: 'Reasoning-style output observed live — last resort' }),
  gemini: {
    id:          'gemini',
    label:       'Aider + Gemini 2.5 Flash',
    type:        'aider',
    aiderModel:  'gemini/gemini-2.5-flash',
    envKey:      'GEMINI_API_KEY',
    description: 'Non-NVIDIA fallback — covers an NVIDIA NIM-wide outage. gemini-2.5-pro has 0 free-tier quota on this key; flash does not.',
  },
  // Kilo Gateway (https://kilo.ai/docs/gateway) needs no API key/account at
  // all for its ':free' models — confirmed live 2026-07-29, unauthenticated
  // requests are IP-rate-limited to 200/hour. 'kilo-auto/free' is Kilo's own
  // auto-router rather than one fixed model name — one of Kilo's other free
  // models (kwaipilot/kat-coder-pro-v2.5:free) got discontinued mid-testing
  // this same session, so pointing at their router self-heals around that
  // instead of us hardcoding a model that can vanish under us. True last
  // resort: a genuinely different provider/infra than NVIDIA NIM (real
  // redundancy, not just another NVIDIA model), but the weakest guarantees
  // here (shared IP-wide rate limit, unpredictable which underlying model
  // actually serves the request, reasoning-style output observed live).
  kilo: {
    id:          'kilo',
    label:       'Kilo Gateway Auto (free, no key)',
    type:        'openai_compatible',
    aiderModel:  'openai/kilo-auto/free',
    apiBase:     'https://api.kilo.ai/api/gateway',
    reasoning:   true,
    description: 'No-signup fallback via Kilo Gateway\'s free auto-router — different infra than NVIDIA NIM',
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

// Plain instruction models first (safest, most reliable), reasoning-family
// models last (may need one wasted attempt before taskBuilder.ts's retry
// logic moves past them), Gemini as the only cross-provider fallback for an
// NVIDIA NIM-wide outage. This is the full pool — "unlimited" in the sense
// that nothing is capped by count, only by which builders have a live key.
const SAFE_POOL = [
  'nvidia', 'llama_8b', 'llama_3b', 'llama_1b',
  'gpt_oss_120b', 'gpt_oss_20b', 'minimax', 'gemma_31b', 'poolside', 'stepfun',
  'mistral_codestral', 'mistral_small', 'mistral_large', 'openrouter_gemma',
];
const REASONING_POOL = [
  'nemotron_super_49b', 'nemotron_super_49b_v15', 'nemotron_3_super_120b',
  'nemotron_3_ultra_550b', 'nemotron_mini', 'nemotron_3_nano_30b',
  'nemotron_nano_9b', 'mistral_nemotron',
  'openrouter_gpt_oss_20b', 'openrouter_north_mini', 'openrouter_ling',
];
const FULL_NVIDIA_POOL = [...SAFE_POOL, ...REASONING_POOL];
// Everything after the NVIDIA pool, tried in order once NVIDIA is fully
// exhausted: Gemini (real cross-provider fallback), then Kilo Gateway's
// free auto-router (no key needed, weakest guarantees, true last resort).
const OUTER_FALLBACKS = ['gemini', 'kilo'];
const FULL_POOL = [...FULL_NVIDIA_POOL, ...OUTER_FALLBACKS];

function chainFor(builderId: string): string[] {
  return FULL_POOL.filter(id => id !== builderId);
}

const FALLBACK_CHAIN: Record<string, string[]> = Object.fromEntries(
  FULL_POOL.map(id => [id, chainFor(id)])
);
FALLBACK_CHAIN['opencode'] = FULL_POOL;

/**
 * `tried` must include every builder already attempted (not just the one
 * that just failed) — chainFor() only excludes the single builder passed
 * to it, so without this, falling back from e.g. llama_8b (chain: nvidia,
 * llama_3b, ...) proposes 'nvidia' again since it's not "the failed
 * builder" for llama_8b's own chain, even though it was already tried
 * earlier in the same task. Confirmed as a real bug by CodeRabbit + Qodo
 * independently (2026-07-29) — without this, taskBuilder.ts/aiderRunner.ts's
 * triedBuilders.includes(next) guard stopped the walk after 2 builders
 * instead of traversing the full ~22-model pool.
 */
function getFallbackBuilder(failedBuilder: string, tried: string[] = []): string | null {
  const chain = FALLBACK_CHAIN[failedBuilder] || FULL_POOL;
  const excluded = new Set([failedBuilder, ...tried]);
  for (const candidate of chain) {
    if (excluded.has(candidate)) continue;
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
  if (config.id === 'gemini') {
    env['GEMINI_API_KEY'] = process.env['GEMINI_API_KEY'] || '';
  } else if (config.envKey === 'MISTRAL_API_KEY') {
    env['MISTRAL_API_KEY'] = process.env['MISTRAL_API_KEY'] || '';
  } else if (config.envKey === 'OPENROUTER_API_KEY') {
    env['OPENROUTER_API_KEY'] = process.env['OPENROUTER_API_KEY'] || '';
  } else if (config.id === 'kilo') {
    // Kilo's free tier is genuinely unauthenticated, but aider's OpenAI
    // client still wants a non-empty key string to initialize — Kilo
    // ignores its value entirely for ':free' models.
    env['OPENAI_API_KEY']  = 'kilo-free-tier-no-key-required';
    env['OPENAI_API_BASE'] = config.apiBase;
    env['OPENAI_BASE_URL'] = config.apiBase;
  } else if (config.envKey === 'NVIDIA_API_KEY') {
    env['OPENAI_API_KEY']  = process.env['NVIDIA_API_KEY'] || '';
    env['OPENAI_API_BASE'] = NVIDIA_BASE;
    env['OPENAI_BASE_URL'] = NVIDIA_BASE;
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
