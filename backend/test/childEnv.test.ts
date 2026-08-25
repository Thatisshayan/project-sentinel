import { buildChildEnv } from '../src/utils/childEnv';

describe('buildChildEnv', () => {
  const ORIGINAL = process.env;

  afterEach(() => {
    process.env = ORIGINAL;
  });

  it('passes only allowlisted base vars, not the full process.env', () => {
    process.env = {
      ...ORIGINAL,
      PATH: '/usr/bin',
      HOME: '/home/ci',
      NODE_ENV: 'production',
      // Secrets that must NOT leak into the child:
      DATABASE_URL: 'postgres://secret@db',
      TELEGRAM_BOT_TOKEN: 'leak-me',
      SENTRY_DSN: 'https://leak@sentry',
    } as NodeJS.ProcessEnv;

    const scoped = buildChildEnv();
    expect(scoped['PATH']).toBe('/usr/bin');
    expect(scoped['HOME']).toBe('/home/ci');
    expect(scoped['NODE_ENV']).toBe('production');
    // Sensitive vars are excluded:
    expect(scoped['DATABASE_URL']).toBeUndefined();
    expect(scoped['TELEGRAM_BOT_TOKEN']).toBeUndefined();
    expect(scoped['SENTRY_DSN']).toBeUndefined();
  });

  it('passes allowlisted provider keys', () => {
    process.env = {
      ...ORIGINAL,
      NVIDIA_API_KEY: 'nv-key',
      ANTHROPIC_API_KEY: 'an-key',
      GEMINI_API_KEY: 'ge-key',
      DASHSCOPE_API_KEY: 'ds-key',
      DEEPSEEK_API_KEY: 'dk-key',
    } as NodeJS.ProcessEnv;

    const scoped = buildChildEnv();
    expect(scoped['NVIDIA_API_KEY']).toBe('nv-key');
    expect(scoped['ANTHROPIC_API_KEY']).toBe('an-key');
    expect(scoped['GEMINI_API_KEY']).toBe('ge-key');
    expect(scoped['DASHSCOPE_API_KEY']).toBe('ds-key');
    expect(scoped['DEEPSEEK_API_KEY']).toBe('dk-key');
  });

  it('applies caller-supplied overrides (trusted input)', () => {
    process.env = { ...ORIGINAL } as NodeJS.ProcessEnv;
    const scoped = buildChildEnv({ OPENAI_API_BASE: 'https://example/v1' });
    expect(scoped['OPENAI_API_BASE']).toBe('https://example/v1');
  });

  it('omits undefined allowlisted keys', () => {
    process.env = { ...ORIGINAL } as NodeJS.ProcessEnv;
    delete process.env['NVIDIA_API_KEY'];
    const scoped = buildChildEnv();
    // No NVIDIA_API_KEY set -> should be absent, not undefined-valued leak
    expect('NVIDIA_API_KEY' in scoped).toBe(false);
  });
});
