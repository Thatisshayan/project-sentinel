import { NextResponse } from "next/server";

export async function GET() {
  const base = process.env.SENTINEL_API_URL;
  const key  = process.env.SENTINEL_UI_KEY;
  if (!base) return NextResponse.json([], { status: 200 });
  try {
    const r = await fetch(`${base}/api/agents`, {
      headers: { ...(key ? { "x-sentinel-key": key } : {}) },
      next: { revalidate: 15 },
    });
    if (!r.ok) return NextResponse.json([], { status: 200 });
    return NextResponse.json(await r.json());
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
