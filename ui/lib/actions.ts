"use client";

import { toast } from "@/lib/toast";

// Client-side helper — calls the /api/action proxy so SENTINEL_UI_KEY stays server-side
export async function callAction(path: string, body?: object, method: "POST" | "DELETE" = "POST") {
  try {
    const r = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, body, method }),
    });
    const data = await r.json().catch(() => null);
    // Prefer the backend's own error message (e.g. "Not implemented — use
    // Telegram command /sentinel security-patch <repo>") over a generic
    // "Action failed: 501" — the backend route often explains exactly what
    // to do instead, which a bare status code throws away.
    if (!r.ok) throw new Error(data?.error || `Action failed: ${r.status}`);
    return data;
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Request failed", "Action failed");
    throw err;
  }
}
