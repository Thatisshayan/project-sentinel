import { NextRequest } from "next/server";

// CSRF/origin guard for the UI's own API routes.
//
// Browsers only attach an `Origin` header to state-changing requests
// (POST/PUT/DELETE) or cross-origin ones — a plain same-origin GET fetch()
// (e.g. the sidebar's `fetch("/api/stats")`) sends no Origin header at all.
// An earlier version of this check required an exact Origin match
// unconditionally, which rejected every legitimate GET request in
// production (dev mode masked this — NODE_ENV !== "production" there
// short-circuits the check entirely).
//
// That was over-corrected to exempt GET/HEAD entirely regardless of Origin
// — which made the check a no-op for GET: a malicious page on another
// origin can have a victim's browser fetch() one of these GET routes (the
// browser sends its true Origin, e.g. "https://evil.com", and it would
// pass unconditionally), even though the browser's same-origin policy would
// otherwise have blocked the malicious page from reading the response.
// Flagged by Qodo on PR #72.
//
// The correct rule: an Origin header is only ever attached by a browser for
// a genuinely cross-origin (or state-changing) request — a non-browser
// client (curl, a script) can trivially omit it or spoof any value, so this
// check was never real protection against those; it only meaningfully
// stops a *browser*, which cannot lie about its own Origin. So: no Origin
// header at all → allow (covers same-origin GET fetches, and non-browser
// clients this check can't gate anyway); an Origin header that IS present
// but doesn't match → reject (the actual cross-origin-browser-GET case).
export function isValidOrigin(req: NextRequest): boolean {
  if (process.env.NODE_ENV !== "production") return true; // dev: allow all

  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  const isSameOrigin = origin === `https://${host}` || origin === process.env.APP_URL;

  if (req.method === "GET" || req.method === "HEAD") {
    return origin === null || isSameOrigin;
  }

  return isSameOrigin;
}
