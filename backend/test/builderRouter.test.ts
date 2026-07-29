/**
 * Regression guard for a bug CodeRabbit and Qodo independently caught in
 * PR #57: getFallbackBuilder() only excluded the single builder just
 * passed to it, so falling back a second time within the same task walk
 * proposed an already-tried builder again (chainFor() always starts from
 * the same FULL_POOL order) and callers' triedBuilders.includes() guard
 * stopped the walk after 2 builders instead of traversing the full pool.
 */
import builderRouter from '../src/builderRouter';

const { getFallbackBuilder, listBuilders } = builderRouter;

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

    // Should have walked through more than just the first couple of builders.
    expect(steps).toBeGreaterThan(5);
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
