import { NextResponse } from "next/server";

export async function GET() {
  const base = process.env.SENTINEL_API_URL;
  const key  = process.env.SENTINEL_UI_KEY;
  if (!base) return NextResponse.json([], { status: 200 });

  try {
    const r = await fetch(`${base}/api/agent-room/messages?limit=50`, {
      headers: key ? { "x-sentinel-key": key } : {},
      next: { revalidate: 0 },
    });
    if (!r.ok) return NextResponse.json([]);
    const data = await r.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json([]);
  }
}
