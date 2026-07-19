import { NextRequest, NextResponse } from "next/server";

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

function isAllowedPath(path: string): boolean {
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
      },
      body: JSON.stringify(body ?? {}),
    });
    const data = await r.json().catch(() => ({}));
    return NextResponse.json(data, { status: r.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
