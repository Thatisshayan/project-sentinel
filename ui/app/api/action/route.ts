import { NextRequest, NextResponse } from "next/server";

// Universal proxy — client sends { path, body } → we forward to backend with secret key
export async function POST(req: NextRequest) {
  const base = process.env.SENTINEL_API_URL;
  const key  = process.env.SENTINEL_UI_KEY;
  if (!base) return NextResponse.json({ error: "No API URL configured" }, { status: 503 });

  const { path, body } = await req.json();
  if (!path?.startsWith("/api/")) return NextResponse.json({ error: "Invalid path" }, { status: 400 });

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
