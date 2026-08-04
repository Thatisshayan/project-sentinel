import { NextRequest, NextResponse } from "next/server";
import { isValidOrigin } from "@/lib/originGuard";

export async function GET(req: NextRequest) {
  const base = process.env.SENTINEL_API_URL;
  const key  = process.env.SENTINEL_UI_KEY;
  if (!base) return NextResponse.json({ error: "No API URL configured" }, { status: 503 });
  if (!isValidOrigin(req)) return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });

  try {
    const r = await fetch(`${base}/api/agent-room/messages?limit=50`, {
      headers: key ? { "x-sentinel-key": key } : {},
      next: { revalidate: 0 },
    });
    if (!r.ok) return NextResponse.json({ error: `Backend error: ${r.status}` }, { status: r.status });
    const data = await r.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
