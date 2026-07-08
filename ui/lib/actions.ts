"use client";

// Client-side helper — calls the /api/action proxy so SENTINEL_UI_KEY stays server-side
export async function callAction(path: string, body?: object) {
  const r = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, body }),
  });
  if (!r.ok) throw new Error(`Action failed: ${r.status}`);
  return r.json();
}
