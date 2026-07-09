import { NextResponse } from "next/server";

export async function GET() {
  const base = process.env.SENTINEL_API_URL;
  const key  = process.env.SENTINEL_UI_KEY;
  if (!base) return NextResponse.json({ error: "No API URL configured" }, { status: 503 });
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
