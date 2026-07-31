type RateLimitStore = Map<string, { count: number; resetTime: number }>;

const rateLimitStore: RateLimitStore = new Map();

// Rate limit configuration
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 60; // max 60 requests per minute

export function rateLimitMiddleware(ip: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  let clientData = rateLimitStore.get(ip);

  if (!clientData || now > clientData.resetTime) {
    // New window
    clientData = { count: 0, resetTime: now + RATE_LIMIT_WINDOW_MS };
    rateLimitStore.set(ip, clientData);
  }

  clientData.count++;

  const allowed = clientData.count <= RATE_LIMIT_MAX_REQUESTS;
  const remaining = Math.max(0, RATE_LIMIT_MAX_REQUESTS - clientData.count);

  return { allowed, remaining, resetAt: clientData.resetTime };
}

export function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const [ip, data] of Array.from(rateLimitStore.entries())) {
    if (now > data.resetTime) {
      rateLimitStore.delete(ip);
    }
  }
}

// Cleanup expired entries every 5 minutes
setInterval(cleanupExpiredEntries, 5 * 60 * 1000);
