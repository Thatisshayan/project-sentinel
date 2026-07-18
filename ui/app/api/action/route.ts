import { NextRequest, NextResponse } from "next/server";

// Only these backend paths may be reached through the universal action proxy.
// Prevents an attacker from pivoting the proxy to arbitrary backend routes.
const ALLOWED_PATHS = new Set<string>([
  "/api/portfolio",
  "/api/agents",
  "/api/sprint/approve",
  "/api/sprint/skip",
  "/api/system/pause",
  "/api/system/resume",
  "/api/telegram/command",
  "/api/settings/update",
]);

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
  if (!ALLOWED_PATHS.has(path)) {
    return NextResponse.json({ error: "Path not allowed" }, { status: 403 });
  }

  try {
    const r = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { "x-sentinel-key": key } : {}),
      },
      body: JSON.stringify(body ?? {}),
    });
    const data = await r.json().catch(() => ({}));
    return NextResponse.json(data, { status: r.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
