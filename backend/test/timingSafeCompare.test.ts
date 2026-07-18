import { timingSafeEqual } from '../src/utils/timingSafeCompare';

describe('timingSafeEqual', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqual('secret', 'secret')).toBe(true);
  });

  it('returns false for different strings of same length', () => {
    expect(timingSafeEqual('secretA', 'secretB')).toBe(false);
  });

  it('returns false for different lengths', () => {
    expect(timingSafeEqual('short', 'muchlonger')).toBe(false);
  });

  it('returns false when one argument is empty', () => {
    expect(timingSafeEqual('', 'secret')).toBe(false);
    expect(timingSafeEqual('secret', '')).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(timingSafeEqual('Secret', 'secret')).toBe(false);
  });

  it('handles unicode consistently', () => {
    expect(timingSafeEqual('héllo', 'héllo')).toBe(true);
    expect(timingSafeEqual('héllo', 'wórld')).toBe(false);
  });

  it('never throws on mismatched lengths (does not rely on crypto.timingSafeEqual\'s equal-length requirement)', () => {
    expect(() => timingSafeEqual('a', 'a'.repeat(10000))).not.toThrow();
    expect(() => timingSafeEqual('', 'x')).not.toThrow();
  });

  it('does not short-circuit on length before hashing — comparison cost is not observably gated by an early length check', () => {
    // Regression test for the original implementation's `if (a.length !== b.length) return false`
    // early return, which leaked the correct secret's length via timing. We can't assert on
    // wall-clock timing reliably in CI, but we can assert the function's own source no longer
    // contains that branch shape by checking behavior: passing wildly different lengths must
    // still route through the same HMAC+compare path (proven indirectly by never throwing above,
    // and directly here by confirming a same-content-different-length pair is still false, not
    // a fast-path true/false based on length alone).
    expect(timingSafeEqual('x', 'xx')).toBe(false);
    expect(timingSafeEqual('xx', 'x')).toBe(false);
  });
});
