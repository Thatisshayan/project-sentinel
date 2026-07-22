import { NextRequest, NextResponse } from "next/server";
import { rateLimitMiddleware } from "@/lib/rateLimit";

// Rate limit configuration
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 60; // max 60 requests per minute

// Rate limit store (in-memory, resets on container restart)
type RateLimitStore = Map<string, { count: number; resetTime: number }>;
const rateLimitStore: RateLimitStore = new Map();

function getRateLimitKey(req: NextRequest): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  return "unknown";
}

function checkRateLimit(req: NextRequest): { allowed: boolean; remaining: number; resetAt: number } {
  const key = getRateLimitKey(req);
  const now = Date.now();
  let clientData = rateLimitStore.get(key);

  if (!clientData || now > clientData.resetTime) {
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

// CSRF/origin guard: in production only the app's own origin may call this route.
function isValidOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (process.env.NODE_ENV === "production") {
    return origin === `https://${host}` || origin === process.env.APP_URL;
  }
  return true; // dev: allow all
}

export async function GET(req: NextRequest) {
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
  const key  = process.env.SENTINEL_UI_KEY;
  if (!base) return NextResponse.json({ error: "No API URL configured" }, { status: 503 });
  if (!isValidOrigin(req)) return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });

  try {
    const headers = { 
      ...(key ? { "x-sentinel-key": key } : {}),
      "X-RateLimit-Remaining": rateLimit.remaining.toString(),
    };
    const res = await fetch(`${base}/api/settings`, { headers });
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    return NextResponse.json(data, {
      headers: {
        "X-RateLimit-Remaining": rateLimit.remaining.toString(),
        "X-RateLimit-Reset": rateLimit.resetAt.toString(),
      }
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

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
  const key  = process.env.SENTINEL_UI_KEY;
  if (!base) return NextResponse.json({ error: "No API URL configured" }, { status: 503 });
  if (!isValidOrigin(req)) return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });

  try {
    const body = await req.json();
    const headers = {
      "Content-Type": "application/json",
      ...(key ? { "x-sentinel-key": key } : {}),
      "X-RateLimit-Remaining": rateLimit.remaining.toString(),
    };
    const res = await fetch(`${base}/api/settings/update`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    return NextResponse.json(data, {
      headers: {
        "X-RateLimit-Remaining": rateLimit.remaining.toString(),
        "X-RateLimit-Reset": rateLimit.resetAt.toString(),
      }
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
