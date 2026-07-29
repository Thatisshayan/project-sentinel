import loopGuard from '../src/utils/loopGuard';

const { LoopGuard } = loopGuard;

describe('LoopGuard', () => {
  it('allows exactly maxIterations ticks before stopping', async () => {
    const guard = new LoopGuard({ label: 'test', maxIterations: 3, onEscalate: jest.fn() });

    expect(await guard.tick()).toBe(true);
    expect(await guard.tick()).toBe(true);
    expect(await guard.tick()).toBe(true);
    expect(await guard.tick()).toBe(false);
  });

  it('fires onEscalate exactly once even if tick() keeps being called past the cap', async () => {
    const onEscalate = jest.fn().mockResolvedValue(undefined);
    const guard = new LoopGuard({ label: 'test', maxIterations: 1, onEscalate });

    expect(await guard.tick()).toBe(true);
    expect(await guard.tick()).toBe(false);
    expect(await guard.tick()).toBe(false);
    expect(await guard.tick()).toBe(false);

    expect(onEscalate).toHaveBeenCalledTimes(1);
    expect(onEscalate).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'test', iterations: 1 })
    );
  });

  it('does not let a throwing onEscalate break the guard or the caller', async () => {
    const onEscalate = jest.fn().mockRejectedValue(new Error('telegram down'));
    const guard = new LoopGuard({ label: 'test', maxIterations: 1, onEscalate });

    await guard.tick();
    await expect(guard.tick()).resolves.toBe(false);
    expect(onEscalate).toHaveBeenCalledTimes(1);
  });

  it('tracks iterations correctly', async () => {
    const guard = new LoopGuard({ label: 'test', maxIterations: 5, onEscalate: jest.fn() });
    await guard.tick();
    await guard.tick();
    expect(guard.iterations).toBe(2);
  });
});
