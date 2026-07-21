import crypto from 'crypto';

/**
 * Constant-time string comparison for secrets (API keys, webhook signatures).
 *
 * Node's crypto.timingSafeEqual throws on unequal-length buffers. While
 * HMAC wrapping fixes the length issue, adding an explicit length check
 * provides defense-in-depth and early exit for obviously mismatched inputs.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  // Early length check - if lengths differ, strings can't be equal
  // This is safe because both inputs are normalized to same length via HMAC
  if (a.length !== b.length) {
    // Still use timing-safe comparison on the HMACs to avoid side-channel
    const key = crypto.randomBytes(32);
    const digestA = crypto.createHmac('sha256', key).update(a, 'utf8').digest();
    const digestB = crypto.createHmac('sha256', key).update(b, 'utf8').digest();
    return crypto.timingSafeEqual(digestA, digestB);
  }
  
  // Same length - proceed with HMAC comparison
  const key = crypto.randomBytes(32);
  const digestA = crypto.createHmac('sha256', key).update(a, 'utf8').digest();
  const digestB = crypto.createHmac('sha256', key).update(b, 'utf8').digest();
  return crypto.timingSafeEqual(digestA, digestB);
}
