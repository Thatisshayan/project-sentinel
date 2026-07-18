import { execAsync, execAsyncQuiet } from '../src/utils/execAsync';

describe('execAsync', () => {
  it('returns trimmed stdout via execAsyncQuiet', async () => {
    const out = await execAsyncQuiet('echo hello');
    expect(out).toBe('hello');
  });

  it('returns both stdout and stderr', async () => {
    const res = await execAsync('echo out && echo err 1>&2');
    expect(res.stdout.trim()).toBe('out');
    expect(res.stderr.trim()).toBe('err');
  });

  it('honours custom timeout option', async () => {
    const res = await execAsync('echo fast', { timeout: 5000 });
    expect(res.stdout.trim()).toBe('fast');
  });

  it('allows injecting env vars', async () => {
    const res = await execAsync('node -e "process.stdout.write(process.env.EXEC_ASYNC_TEST || \'\')"', {
      env: { ...process.env, EXEC_ASYNC_TEST: 'injected' },
    });
    expect(res.stdout.trim()).toBe('injected');
  });

  it('rejects on non-zero exit', async () => {
    await expect(execAsync('exit 3')).rejects.toBeTruthy();
  });

  describe('scoped option', () => {
    const originalPath = process.env.PATH;

    afterEach(() => {
      delete process.env.SENTINEL_TEST_SECRET;
      process.env.PATH = originalPath;
    });

    it('does not leak arbitrary process.env vars into the child when scoped: true', async () => {
      process.env.SENTINEL_TEST_SECRET = 'do-not-leak';
      const res = await execAsync(
        'node -e "process.stdout.write(process.env.SENTINEL_TEST_SECRET || \'ABSENT\')"',
        { scoped: true }
      );
      expect(res.stdout.trim()).toBe('ABSENT');
    });

    it('leaks process.env vars into the child when scoped is omitted (existing default behavior)', async () => {
      process.env.SENTINEL_TEST_SECRET = 'leaks-by-default';
      const res = await execAsync(
        'node -e "process.stdout.write(process.env.SENTINEL_TEST_SECRET || \'ABSENT\')"'
      );
      expect(res.stdout.trim()).toBe('leaks-by-default');
    });

    it('still allows PATH to resolve the command when scoped: true (allowlisted base var)', async () => {
      const res = await execAsync('node --version', { scoped: true });
      expect(res.stdout.trim()).toMatch(/^v\d+\.\d+\.\d+/);
    });

    it('explicit env option still overrides scoped defaults', async () => {
      const res = await execAsync(
        'node -e "process.stdout.write(process.env.SENTINEL_TEST_SECRET || \'ABSENT\')"',
        { scoped: true, env: { ...process.env, SENTINEL_TEST_SECRET: 'explicit-override' } }
      );
      expect(res.stdout.trim()).toBe('explicit-override');
    });
  });
});
