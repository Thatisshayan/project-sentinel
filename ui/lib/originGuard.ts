import { NextRequest } from "next/server";

// CSRF/origin guard for the UI's own API routes.
//
// Browsers only attach an `Origin` header to state-changing requests
// (POST/PUT/DELETE) or cross-origin ones — a plain same-origin GET fetch()
// (e.g. the sidebar's `fetch("/api/stats")`) sends no Origin header at all.
// The previous version of this check required an exact Origin match
// unconditionally, which rejected every legitimate GET request in
// production (dev mode masked this — NODE_ENV !== "production" there
// short-circuits the check entirely) while leaving state-changing routes
// unaffected, since POST does carry Origin. Safe/idempotent GET requests
// carry no CSRF risk (they can't mutate state), so they're exempt; only
// non-GET requests are held to the strict Origin match.
export function isValidOrigin(req: NextRequest): boolean {
  if (process.env.NODE_ENV !== "production") return true; // dev: allow all

  if (req.method === "GET" || req.method === "HEAD") return true;

  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  return origin === `https://${host}` || origin === process.env.APP_URL;
}
