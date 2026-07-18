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
});
