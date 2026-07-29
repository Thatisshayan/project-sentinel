import logger from '../logger';

/**
 * Generic iteration cap + human-escalation hook for any "keep retrying
 * until something works" loop. Today's builder-fallback loops
 * (taskBuilder.ts, aiderRunner.ts) are already implicitly bounded by the
 * size of the configured builder pool, but that's an incidental limit, not
 * a deliberate one — and the planned CI/review fix-loop (patch → push →
 * re-review → repeat) has no natural bound like that at all. This gives
 * every such loop the same explicit, configurable ceiling and the same
 * "stop and tell a human" behavior instead of silently grinding forever
 * (or, for the bounded loops today, silently exhausting the pool with no
 * distinct signal that a cap was actually hit).
 */
interface LoopGuardOptions {
  label: string;
  maxIterations: number;
  onEscalate: (info: { label: string; iterations: number; context: Record<string, unknown> }) => void | Promise<void>;
}

class LoopGuard {
  private count = 0;
  private escalated = false;

  constructor(private readonly opts: LoopGuardOptions) {}

  get iterations(): number {
    return this.count;
  }

  /**
   * Call once per loop iteration. Returns true if the loop may continue,
   * false once the cap has been reached — firing the escalation callback
   * exactly once, the first time the cap is crossed.
   */
  async tick(context: Record<string, unknown> = {}): Promise<boolean> {
    this.count++;
    if (this.count <= this.opts.maxIterations) {
      return true;
    }
    if (!this.escalated) {
      this.escalated = true;
      logger.error(
        { label: this.opts.label, iterations: this.count - 1, maxIterations: this.opts.maxIterations, context },
        'LoopGuard: iteration cap reached — escalating to human'
      );
      try {
        await this.opts.onEscalate({ label: this.opts.label, iterations: this.count - 1, context });
      } catch (err: any) {
        logger.error({ err: err instanceof Error ? (err.stack ?? err.message) : String(err), label: this.opts.label },
          'LoopGuard: onEscalate callback itself threw');
      }
    }
    return false;
  }
}

const DEFAULT_MAX_ITERATIONS = (): number => parseInt(process.env['LOOP_GUARD_MAX_ITERATIONS'] || '25', 10);

export = { LoopGuard, DEFAULT_MAX_ITERATIONS };
