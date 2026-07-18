import { NextRequest, NextResponse } from "next/server";

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
  const base = process.env.SENTINEL_API_URL;
  const key  = process.env.SENTINEL_UI_KEY;
  if (!base) return NextResponse.json({ error: "No API URL configured" }, { status: 503 });
  if (!isValidOrigin(req)) return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
  try {
    const r = await fetch(`${base}/api/agents`, {
      headers: { ...(key ? { "x-sentinel-key": key } : {}) },
      next: { revalidate: 15 },
    });
    if (!r.ok) return NextResponse.json({ error: `Backend error: ${r.status}` }, { status: r.status });
    return NextResponse.json(await r.json());
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
