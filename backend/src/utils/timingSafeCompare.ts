import crypto from 'crypto';

/**
 * Constant-time string comparison for secrets (API keys, webhook signatures).
 *
 * Node's crypto.timingSafeEqual throws on unequal-length buffers, so a naive
 * wrapper needs an `a.length !== b.length` early return — but that early
 * return itself leaks the correct secret's length via response timing.
 *
 * Instead, both inputs are HMAC'd with the same random-per-call key first.
 * The resulting digests are always a fixed 32 bytes regardless of input
 * length, so no length branch is needed and crypto.timingSafeEqual never
 * throws. This is the standard mitigation (see OWASP's guidance on
 * timing-attack-resistant comparison for variable-length secrets).
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const key = crypto.randomBytes(32);
  const digestA = crypto.createHmac('sha256', key).update(a, 'utf8').digest();
  const digestB = crypto.createHmac('sha256', key).update(b, 'utf8').digest();
  return crypto.timingSafeEqual(digestA, digestB);
}
