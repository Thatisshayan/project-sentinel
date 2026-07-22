import { NextRequest, NextResponse } from "next/server";
import { rateLimitMiddleware } from "@/lib/rateLimit";

// Rate limit configuration
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 60; // max 60 requests per minute

// Rate limit store (in-memory, resets on container restart)
type RateLimitStore = Map<string, { count: number; resetTime: number }>;
const rateLimitStore: RateLimitStore = new Map();

function getRateLimitKey(req: NextRequest): string {
  // Use x-forwarded-for header for production, fall back to socket IP
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  // In production, this would be the Cloudflare/Railway proxy IP
  // For Railway deployments, we rely on x-forwarded-for
  return "unknown";
}

function checkRateLimit(req: NextRequest): { allowed: boolean; remaining: number; resetAt: number } {
  const key = getRateLimitKey(req);
  const now = Date.now();
  let clientData = rateLimitStore.get(key);

  if (!clientData || now > clientData.resetTime) {
    // New window
    clientData = { count: 0, resetTime: now + RATE_LIMIT_WINDOW_MS };
    rateLimitStore.set(key, clientData);
  }

  clientData.count++;
  
  const allowed = clientData.count <= RATE_LIMIT_MAX_REQUESTS;
  const remaining = Math.max(0, RATE_LIMIT_MAX_REQUESTS - clientData.count);
  const resetAt = clientData.resetTime;

  return { allowed, remaining, resetAt };
}

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of Array.from(rateLimitStore.entries())) {
    if (now > data.resetTime) {
      rateLimitStore.delete(ip);
    }
  }
}, 5 * 60 * 1000);

// Only these backend paths may be reached through the universal action proxy.
// Prevents an attacker from pivoting the proxy to arbitrary backend routes.
// Includes both exact static routes and the dynamic (:id/:name) routes the
// UI actually calls — a literal-string Set previously missed every dynamic
// path (per-repo audit, per-agent toggle, security-issue patch) and several
// static ones the UI calls under different names than what was allowlisted
// (/api/command vs. the never-called /api/telegram/command,
// /api/system/audit-all, /api/system/security-scan), so those buttons
// always 403'd here even though the backend route itself works fine.
const ALLOWED_PATH_PATTERNS: RegExp[] = [
  /^\/api\/portfolio$/,
  /^\/api\/agents$/,
  /^\/api\/agents\/[\w.-]+\/toggle$/,
  /^\/api\/repo\/[\w.-]+\/audit$/,
  /^\/api\/sprint\/approve$/,
  /^\/api\/sprint\/skip$/,
  /^\/api\/system\/pause$/,
  /^\/api\/system\/resume$/,
  /^\/api\/system\/audit-all$/,
  /^\/api\/system\/security-scan$/,
  /^\/api\/security\/issue\/[\w.-]+\/patch$/,
  /^\/api\/command$/,
  /^\/api\/settings\/update$/,
];

// The regex patterns' [\w.-]+ segments technically accept a literal "." or
// ".." as the whole segment value (e.g. /api/repo/../audit matches the
// /api/repo/[\w.-]+/audit pattern as written). fetch()'s URL normalization
// then collapses that to a different path than what was validated — reject
// dot-only path segments outright before the allowlist check runs.
function hasDotSegment(path: string): boolean {
  return path.split("/").some((segment) => segment === "." || segment === "..");
}

function isAllowedPath(path: string): boolean {
  if (hasDotSegment(path)) return false;
  return ALLOWED_PATH_PATTERNS.some((p) => p.test(path));
}

// CSRF/origin guard: in production only the app's own origin may call this route.
function isValidOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (process.env.NODE_ENV === "production") {
    return origin === `https://${host}` || origin === process.env.APP_URL;
  }
  return true; // dev: allow all
}

// Universal proxy — client sends { path, body } → we forward to backend with secret key
export async function POST(req: NextRequest) {
  const rateLimit = checkRateLimit(req);
  if (!rateLimit.allowed) {
    return NextResponse.json({ 
      error: "Rate limit exceeded", 
      retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000)
    }, { 
      status: 429,
      headers: {
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": rateLimit.resetAt.toString(),
        "Retry-After": Math.ceil((rateLimit.resetAt - Date.now()) / 1000).toString()
      }
    });
  }

  const base = process.env.SENTINEL_API_URL;
  const key = process.env.SENTINEL_UI_KEY;
  if (!base) return NextResponse.json({ error: "No API URL configured" }, { status: 503 });

  if (!isValidOrigin(req)) {
    return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
  }

  const { path, body } = await req.json();
  if (typeof path !== "string" || !path.startsWith("/api/")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  if (!isAllowedPath(path)) {
    return NextResponse.json({ error: "Path not allowed" }, { status: 403 });
  }

  try {
    const r = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { "x-sentinel-key": key } : {}),
        "X-RateLimit-Remaining": rateLimit.remaining.toString(),
      },
      body: JSON.stringify(body ?? {}),
    });
    const data = await r.json().catch(() => ({}));
    return NextResponse.json(data, { 
      status: r.status,
      headers: {
        "X-RateLimit-Remaining": rateLimit.remaining.toString(),
        "X-RateLimit-Reset": rateLimit.resetAt.toString(),
      }
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
