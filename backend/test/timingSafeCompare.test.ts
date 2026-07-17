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
});
