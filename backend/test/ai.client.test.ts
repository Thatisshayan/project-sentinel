import axios from 'axios';
import { callAnyProvider } from '../src/ai/client';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
});

const ENV_KEYS = ['NVIDIA_API_KEY', 'GEMINI_API_KEY', 'DASHSCOPE_API_KEY', 'DEEPSEEK_API_KEY', 'ANTHROPIC_API_KEY', 'AI_PROVIDER_CALLS_ENABLED'] as const;
const ORIGINAL_ENV: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) ORIGINAL_ENV[k] = process.env[k];

function clearProviderKeys(): void {
  for (const k of ENV_KEYS) delete process.env[k];
}

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (ORIGINAL_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL_ENV[k];
  }
});

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

  test('treats an empty response as a failure and tries the next provider', async () => {
    process.env['NVIDIA_API_KEY'] = 'nv-key';
    process.env['GEMINI_API_KEY'] = 'gm-key';
    mockedAxios.post
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: '' } }] } })
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: 'from gemini' } }] } });

    const result = await callAnyProvider({ userPrompt: 'hi' });

    expect(result).toBe('from gemini');
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  test('throws when every provider returns an empty response', async () => {
    process.env['NVIDIA_API_KEY'] = 'nv-key';
    mockedAxios.post.mockResolvedValue({ data: { choices: [{ message: { content: '' } }] } });

    await expect(callAnyProvider({ userPrompt: 'hi' })).rejects.toThrow('empty response');
  });

  test('rejects immediately when AI_PROVIDER_CALLS_ENABLED is disabled, even with keys configured', async () => {
    process.env['NVIDIA_API_KEY'] = 'nv-key';
    process.env['AI_PROVIDER_CALLS_ENABLED'] = 'false';

    await expect(callAnyProvider({ userPrompt: 'hi' })).rejects.toThrow('AI provider calls disabled');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  test('calls Anthropic with temperature and timeoutMs forwarded when opted in', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'an-key';
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'from claude' }] });

    const result = await callAnyProvider({
      userPrompt: 'hi', systemPrompt: 'sys', temperature: 0.3, timeoutMs: 12345,
      includeAnthropic: true,
    });

    expect(result).toBe('from claude');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const [body, options] = mockCreate.mock.calls[0] as any[];
    expect(body.temperature).toBe(0.3);
    expect(body.system).toBe('sys');
    expect(options.timeout).toBe(12345);
  });
});
