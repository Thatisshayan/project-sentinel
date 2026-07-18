import { safeFire, fireAndForget } from './utils/safeFire';
import axios from 'axios';
import logger from './logger';
import { sendTelegramMessage } from './telegramClient';
import { markAgentError } from './agentDb';

interface ProviderProbe {
  name: string;
  key: string;
  url: string;
  auth: () => string;
}

async function probeAIProviders(): Promise<string[]> {
  const probes: ProviderProbe[] = [
    {
      name: 'NVIDIA NIM', key: 'NVIDIA_API_KEY',
      url:  'https://integrate.api.nvidia.com/v1/models',
      auth: () => `Bearer ${process.env['NVIDIA_API_KEY']}`,
    },
    {
      name: 'Gemini',    key: 'GEMINI_API_KEY',
      url:  'https://generativelanguage.googleapis.com/v1beta/openai/models',
      auth: () => `Bearer ${process.env['GEMINI_API_KEY']}`,
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

  const results: string[] = [];
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

  // Alert if any keys are definitely invalid (401/403)
  const invalidProviders = results.filter(r => r.includes('✗'));
  if (invalidProviders.length > 0) {
    await safeFire(sendTelegramMessage(
      `🔴 Sentinel AI Provider Alert\n\n` +
      `${invalidProviders.length} provider(s) have invalid API keys:\n` +
      `${invalidProviders.join('\n')}\n\n` +
      `Go to Railway → Variables and update the key(s) to restore those agents.`,
      null, null
    ), { label: 'providerHealthCheck' })

    // Mark affected agents as error so the UI shows truth instead of idle
    const PROVIDER_AGENT_MAP: Record<string, string[]> = {
      'NVIDIA NIM':       ['nvidia', 'qwen_coder', 'llama_fast'],
      'Gemini':           ['gemini'],
      'DashScope (Qwen)': ['qwen_coder_dash', 'qwen_max', 'qwen_turbo'],
      'DeepSeek':         ['deepseek'],
    };
    for (const line of invalidProviders) {
      const provider = line.match(/✗ (.+?):/)?.[1];
      for (const agentId of (PROVIDER_AGENT_MAP[provider || ''] || [])) {
        await safeFire(markAgentError(agentId, 'invalid_api_key'), { label: 'providerHealthCheck' })
      }
    }
  }

  return results;
}

export = { probeAIProviders };
