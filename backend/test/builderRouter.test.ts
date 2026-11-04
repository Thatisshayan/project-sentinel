/**
 * Regression guard for a bug CodeRabbit and Qodo independently caught in
 * PR #57: getFallbackBuilder() only excluded the single builder just
 * passed to it, so falling back a second time within the same task walk
 * proposed an already-tried builder again (chainFor() always starts from
 * the same FULL_POOL order) and callers' triedBuilders.includes() guard
 * stopped the walk after 2 builders instead of traversing the full pool.
 */
import builderRouter from '../src/builderRouter';

const { getFallbackBuilder, listBuilders, getBuilderConfig } = builderRouter;

describe('getFallbackBuilder', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...savedEnv };
  });

  afterAll(() => {
    process.env = savedEnv;
  });

  it('walks past every builder already tried, not just the one that just failed', () => {
    process.env['NVIDIA_API_KEY'] = 'test-key';
    delete process.env['GEMINI_API_KEY'];
    delete process.env['MISTRAL_API_KEY'];
    delete process.env['OPENROUTER_API_KEY'];
    delete process.env['OPENCODE_API_KEY'];

    const tried: string[] = ['nvidia'];
    const second = getFallbackBuilder('nvidia', tried);
    expect(second).not.toBeNull();
    expect(second).not.toBe('nvidia');
    tried.push(second as string);

    const third = getFallbackBuilder(second as string, tried);
    expect(third).not.toBeNull();
    expect(tried).not.toContain(third);
  });

  it('eventually exhausts the whole NVIDIA-keyed pool without looping back', () => {
    process.env['NVIDIA_API_KEY'] = 'test-key';
    delete process.env['GEMINI_API_KEY'];
    delete process.env['MISTRAL_API_KEY'];
    delete process.env['OPENROUTER_API_KEY'];
    delete process.env['OPENCODE_API_KEY'];

    const tried: string[] = [];
    let current = 'nvidia';
    tried.push(current);
    let steps = 0;

    for (;;) {
      const next = getFallbackBuilder(current, tried);
      if (!next) break;
      expect(tried).not.toContain(next);
      tried.push(next);
      current = next;
      steps++;
      expect(steps).toBeLessThan(50); // guard against an actual infinite loop
    }

    // Assert complete traversal of every builder configured with a live key
    // — not an arbitrary
    // minimum, so this stays meaningful if the pool's size changes later.
    const configuredIds = listBuilders().filter(b => b.configured).map(b => b.id);
    expect(tried.sort()).toEqual(configuredIds.sort());
    expect(steps).toBe(configuredIds.length - 1);
  });

  it('returns null once every configured-key builder has been tried', () => {
    process.env['NVIDIA_API_KEY'] = 'test-key';
    delete process.env['GEMINI_API_KEY'];
    delete process.env['MISTRAL_API_KEY'];
    delete process.env['OPENROUTER_API_KEY'];
    delete process.env['OPENCODE_API_KEY'];

    const allNvidiaBuilders = listBuilders()
      .filter(b => b.configured)
      .map(b => b.id);

    expect(getFallbackBuilder('nvidia', allNvidiaBuilders)).toBeNull();
  });
});

describe('size floor for code-writing models (2026-11-04)', () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...savedEnv };
    for (const k of Object.keys(process.env)) if (/^(NVIDIA|GEMINI|MISTRAL|OPENROUTER|OPENCODE)_API_KEY/.test(k)) delete process.env[k];
  });
  afterAll(() => { process.env = savedEnv; });

  const SMALL = ['llama_8b', 'llama_3b', 'llama_1b', 'gpt_oss_20b', 'poolside', 'nemotron_mini',
    'nemotron_3_nano_30b', 'nemotron_nano_9b', 'mistral_small', 'openrouter_gpt_oss_20b',
    'openrouter_north_mini', 'openrouter_ling', 'kilo'];

  it('no small or unknown-size model is selectable or reachable by fallback', () => {
    process.env['NVIDIA_API_KEY'] = 'k';
    process.env['GEMINI_API_KEY'] = 'k';
    process.env['MISTRAL_API_KEY'] = 'k';
    process.env['OPENROUTER_API_KEY'] = 'k';
    const ids = listBuilders().map(b => b.id);
    for (const id of SMALL) expect(ids).not.toContain(id);

    const tried: string[] = [];
    let current = 'nvidia';
    for (let i = 0; i < 50; i++) {
      tried.push(current);
      const next = getFallbackBuilder(current, tried);
      if (!next) break;
      current = next;
    }
    for (const id of SMALL) expect(tried).not.toContain(id);
  });

  it('a repo still assigned to a removed model gets the default builder', () => {
    process.env['NVIDIA_API_KEY'] = 'k';
    expect(getBuilderConfig('llama_8b').id).toBe('nvidia');
  });

  it('when no model has a key, fallback returns null instead of a keyless model', () => {
    delete process.env['NVIDIA_API_KEY'];
    delete process.env['GEMINI_API_KEY'];
    delete process.env['MISTRAL_API_KEY'];
    delete process.env['OPENROUTER_API_KEY'];
    delete process.env['OPENCODE_API_KEY'];
    expect(getFallbackBuilder('nvidia', [])).toBeNull();
  });
});
