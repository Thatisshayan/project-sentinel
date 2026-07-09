"use client";

import { toast } from "@/lib/toast";

// Client-side helper — calls the /api/action proxy so SENTINEL_UI_KEY stays server-side
export async function callAction(path: string, body?: object) {
  try {
    const r = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, body }),
    });
    if (!r.ok) throw new Error(`Action failed: ${r.status}`);
    return await r.json();
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Request failed", "Action failed");
    throw err;
  }
}
