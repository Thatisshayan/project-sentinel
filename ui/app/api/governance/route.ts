import { NextRequest, NextResponse } from "next/server";
import { isValidOrigin } from "@/lib/originGuard";

export const revalidate = 30;

export async function GET(req: NextRequest) {
  const base = process.env.SENTINEL_API_URL;
  const key = process.env.SENTINEL_UI_KEY;
  if (!base) return NextResponse.json({ error: "no backend" }, { status: 503 });
  if (!isValidOrigin(req)) return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });

  try {
    const headers = { ...(key ? { "x-sentinel-key": key } : {}) };
    const res = await fetch(`${base}/api/governance/status`, { headers, next: { revalidate: 30 } });
    const body = await res.json().catch(() => ({ error: "invalid upstream response" }));
    return NextResponse.json(body, { status: res.status });
  } catch {
    return NextResponse.json({ error: "upstream error" }, { status: 502 });
  }
}
