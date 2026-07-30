import axios from 'axios';
import { callAnyProvider } from '../src/ai/client';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const ENV_KEYS = ['NVIDIA_API_KEY', 'GEMINI_API_KEY', 'DASHSCOPE_API_KEY', 'DEEPSEEK_API_KEY', 'ANTHROPIC_API_KEY'] as const;

function clearProviderKeys(): void {
  for (const k of ENV_KEYS) delete process.env[k];
}

describe('ai/client callAnyProvider', () => {
  beforeEach(() => {
    clearProviderKeys();
    jest.clearAllMocks();
  });

  test('throws when no provider is configured', async () => {
    await expect(callAnyProvider({ userPrompt: 'hi' })).rejects.toThrow('No AI provider configured');
  });

  test('calls the first configured provider (NVIDIA) with the right payload', async () => {
    process.env['NVIDIA_API_KEY'] = 'nv-key';
    mockedAxios.post.mockResolvedValue({ data: { choices: [{ message: { content: 'hello' } }] } });

    const result = await callAnyProvider({ userPrompt: 'hi', systemPrompt: 'sys', maxTokens: 500, temperature: 0.2 });

    expect(result).toBe('hello');
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    const [url, body, config] = mockedAxios.post.mock.calls[0] as any[];
    expect(url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect(body.messages).toEqual([{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }]);
    expect(body.max_tokens).toBe(500);
    expect(body.temperature).toBe(0.2);
    expect(config.headers.Authorization).toBe('Bearer nv-key');
  });

  test('falls back to the next provider when the first one fails', async () => {
    process.env['NVIDIA_API_KEY'] = 'nv-key';
    process.env['GEMINI_API_KEY'] = 'gm-key';
    mockedAxios.post
      .mockRejectedValueOnce(new Error('nvidia down'))
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: 'from gemini' } }] } });

    const result = await callAnyProvider({ userPrompt: 'hi' });

    expect(result).toBe('from gemini');
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  test('throws the last error when every configured provider fails', async () => {
    process.env['NVIDIA_API_KEY'] = 'nv-key';
    mockedAxios.post.mockRejectedValue(new Error('nvidia down'));

    await expect(callAnyProvider({ userPrompt: 'hi' })).rejects.toThrow('nvidia down');
  });

  test('applies a per-provider model override', async () => {
    process.env['NVIDIA_API_KEY'] = 'nv-key';
    mockedAxios.post.mockResolvedValue({ data: { choices: [{ message: { content: 'ok' } }] } });

    await callAnyProvider({ userPrompt: 'hi', models: { nvidia: 'custom/model' } });

    const [, body] = mockedAxios.post.mock.calls[0] as any[];
    expect(body.model).toBe('custom/model');
  });
});
