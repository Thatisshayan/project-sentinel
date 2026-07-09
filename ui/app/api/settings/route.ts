import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const base = process.env.SENTINEL_API_URL;
  const key  = process.env.SENTINEL_UI_KEY;
  if (!base) return NextResponse.json({ error: "No API URL configured" }, { status: 503 });

  try {
    const headers = { ...(key ? { "x-sentinel-key": key } : {}) };
    const res = await fetch(`${base}/api/settings`, { headers });
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const base = process.env.SENTINEL_API_URL;
  const key  = process.env.SENTINEL_UI_KEY;
  if (!base) return NextResponse.json({ error: "No API URL configured" }, { status: 503 });

  try {
    const body = await req.json();
    const headers = {
      "Content-Type": "application/json",
      ...(key ? { "x-sentinel-key": key } : {}),
    };
    const res = await fetch(`${base}/api/settings/update`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
