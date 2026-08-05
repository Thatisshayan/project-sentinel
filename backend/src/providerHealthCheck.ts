import { safeFire, fireAndForget } from './utils/safeFire';
import axios from 'axios';
import logger from './logger';
import { sendTelegramMessage } from './telegramClient';
import { markAgentError } from './agentDb';
import { allNvidiaKeys } from './utils/nvidiaKeyPool';

interface ProviderProbe {
  name: string;
  key: string;
  url: string;
  auth: () => string;
}

/**
 * NVIDIA gets one probe per configured key (see utils/nvidiaKeyPool.ts —
 * NVIDIA_API_KEY may now be backed by several keys), each labeled so a
 * specific bad key can be identified and rotated without guessing which
 * one. The other providers still have exactly one key each.
 */
async function probeNvidiaKeys(): Promise<string[]> {
  const keys = allNvidiaKeys();
  if (keys.length === 0) return ['  ○ NVIDIA NIM: no key set'];

  const results: string[] = [];
  for (const { key, label } of keys) {
    try {
      await axios.get('https://integrate.api.nvidia.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
        timeout: 6000,
      });
      results.push(`  ✓ NVIDIA NIM (${label}): reachable`);
    } catch (err: any) {
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        results.push(`  ✗ NVIDIA NIM (${label}): key invalid (${status})`);
      } else if (status === 400) {
        results.push(`  ~ NVIDIA NIM (${label}): endpoint format mismatch (key likely OK)`);
      } else {
        results.push(`  ? NVIDIA NIM (${label}): ${status || err.code || err.message}`);
      }
      logger.warn({ label, status }, 'NVIDIA key probe failed');
    }
  }
  return results;
}

async function probeAIProviders(): Promise<string[]> {
  const probes: ProviderProbe[] = [
    {
      name: 'Gemini',    key: 'GEMINI_API_KEY',
      url:  'https://generativelanguage.googleapis.com/v1beta/openai/models',
      auth: () => `Bearer ${process.env['GEMINI_API_KEY']}`,
    },
    // Mistral/OpenRouter back agentRegistry.ts's AGENT_POOL entries
    // (mistral_codestral, openrouter_gemma) — without probes here, an
    // invalid key for either would only surface when a task actually tries
    // to use that builder, instead of being caught proactively like every
    // other provider.
    {
      name: 'Mistral',   key: 'MISTRAL_API_KEY',
      url:  'https://api.mistral.ai/v1/models',
      auth: () => `Bearer ${process.env['MISTRAL_API_KEY']}`,
    },
    {
      name: 'OpenRouter', key: 'OPENROUTER_API_KEY',
      url:  'https://openrouter.ai/api/v1/models',
      auth: () => `Bearer ${process.env['OPENROUTER_API_KEY']}`,
    },
    {
      name: 'DashScope (Qwen)', key: 'DASHSCOPE_API_KEY',
      url:  `${process.env['DASHSCOPE_BASE_URL'] || 'https://dashscope.aliyuncs.com/compatible-mode/v1'}/models`,
      auth: () => `Bearer ${process.env['DASHSCOPE_API_KEY']}`,
    },
    {
      name: 'DeepSeek', key: 'DEEPSEEK_API_KEY',
      url:  'https://api.deepseek.com/models',
      auth: () => `Bearer ${process.env['DEEPSEEK_API_KEY']}`,
    },
  ];

  const results: string[] = await probeNvidiaKeys();
  for (const p of probes) {
    if (!process.env[p.key]) {
      results.push(`  ○ ${p.name}: key not set`);
      continue;
    }
    try {
      await axios.get(p.url, {
        headers: { Authorization: p.auth() },
        timeout: 6000,
      });
      results.push(`  ✓ ${p.name}: reachable`);
      logger.info({ provider: p.name }, 'AI provider reachable');
    } catch (err: any) {
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        results.push(`  ✗ ${p.name}: key invalid (${status})`);
      } else if (status === 400) {
        // 400 = bad request format, not an auth failure — key is likely valid
        results.push(`  ~ ${p.name}: endpoint format mismatch (key likely OK)`);
        logger.info({ provider: p.name }, 'AI provider 400 — key likely valid, /models unsupported');
      } else {
        results.push(`  ? ${p.name}: ${status || err.code || err.message}`);
      }
      logger.warn({ provider: p.name, status }, 'AI provider probe failed');
    }
  }

  logger.info({ results }, 'AI provider health check complete');

  // Alert on invalid (401/403) keys. NVIDIA is special-cased: with several
  // keys in the pool, one bad key doesn't take the whole lane down, so only
  // alert on NVIDIA if *every* configured key came back invalid — a single
  // bad key among several still gets reported in the results list either way.
  const nvidiaLines   = results.filter(r => r.includes('NVIDIA NIM'));
  const nvidiaInvalid = nvidiaLines.filter(r => r.includes('✗'));
  const nvidiaAllDown = nvidiaLines.length > 0 && nvidiaInvalid.length === nvidiaLines.length;

  const otherInvalid = results.filter(r => r.includes('✗') && !r.includes('NVIDIA NIM'));
  const alertLines = [...(nvidiaAllDown ? nvidiaInvalid : []), ...otherInvalid];

  if (alertLines.length > 0) {
    await safeFire(sendTelegramMessage(
      `🔴 Sentinel AI Provider Alert\n\n` +
      `${alertLines.length} key(s) have invalid API keys:\n` +
      `${alertLines.join('\n')}\n\n` +
      `Update the key(s) in backend/.env on the Oracle host and redeploy` +
      ` (docker compose -f docker-compose.prod.yml up -d) to restore those agents.`,
      null, null
    ), { label: 'providerHealthCheck' })

    // Mark affected agents as error so the UI shows truth instead of idle.
    // Keys here must match agentRegistry.ts's AGENT_POOL ids — DashScope and
    // DeepSeek were dropped from the builder pool (builderRouter.ts,
    // 2026-07-29) and are no longer registered as agents at all, so there's
    // nothing to mark for them even though the probe above still checks
    // whether their (now-unused) env keys are configured.
    const PROVIDER_AGENT_MAP: Record<string, string[]> = {
      'NVIDIA NIM':  ['nvidia', 'gpt_oss_120b', 'llama_8b'],
      'Gemini':      ['gemini'],
      'Mistral':     ['mistral_codestral'],
      'OpenRouter':  ['openrouter_gemma'],
    };
    const affectedProviders = new Set<string>();
    if (nvidiaAllDown) affectedProviders.add('NVIDIA NIM');
    for (const line of otherInvalid) {
      const provider = line.match(/✗ (.+?):/)?.[1];
      if (provider) affectedProviders.add(provider);
    }
    for (const provider of affectedProviders) {
      for (const agentId of (PROVIDER_AGENT_MAP[provider] || [])) {
        await safeFire(markAgentError(agentId, 'invalid_api_key'), { label: 'providerHealthCheck', retryable: true })
      }
    }
  }

  return results;
}

export = { probeAIProviders };
