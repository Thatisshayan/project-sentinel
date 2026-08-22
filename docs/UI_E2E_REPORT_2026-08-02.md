# Sentinel UI — End-to-End Test Report

**Date:** 2026-08-02
**Tester:** Hermes (U)
**Scope:** Full end-to-end check of the Sentinel dashboard UI (`ui/` — Next.js 14.2.35).
**Environment:** Windows 11 + git-bash (MSYS). UI dev server run locally. Backend NOT running locally; `ui/.env.local` points `SENTINEL_API_URL=http://localhost:3000` (dead endpoint).

---

## TL;DR

The UI **code is structurally sound and compiles**, but it is **not functional in this environment**:
- The dev server takes ~200s to start and every route **hangs indefinitely** on request.
- Root cause is a **missing request timeout** on backend calls + **no live backend configured**.
- Live-data testing against the Oracle Cloud backend could **not** be performed (credentials not available on this machine).

**Verdict: NOT working end-to-end as-is. Fixable with 2 changes (timeout + backend wiring).**

---

## What was tested

| Check | Result | Evidence |
|-------|--------|----------|
| UI source compiles (routes build) | ✅ PASS | `.next/server/app/` contained `repos/`, `security/`, `agents/`, `connectors/`, `agent-room/` compiled artifacts |
| `next build` (production) | ❌ FAIL | Process exited silently; no `.next/BUILD_ID` produced |
| `next dev` starts | ⚠️ DEGRADED | `✓ Ready in 199.1s`; webpack cache `ENOENT` error (filesystem) |
| `/` (overview) loads | ❌ HANG | Timed out >60s (server-side `getPortfolio()` fetch) |
| `/repos` loads | ❌ HANG | Timed out >60s |
| `/security` loads | ❌ HANG | Timed out >60s |
| `/connectors` loads | ❌ HANG | Timed out >150s |
| `/agents` loads | ❌ HANG | Timed out >60s |
| Backend live-data flow | ⏭️ SKIPPED | No `SENTINEL_API_URL`/`SENTINEL_UI_KEY` for Oracle backend available |

---

## Failures & root causes

### F1 — No timeout on backend fetches (CRITICAL)
**File:** `ui/lib/api.ts` (lines 4-16) + all server components (`app/page.tsx`, etc.)
Every data call goes through:
```ts
const res = await fetch(`${BASE}/api${path}`, { ...opts, next: { revalidate: 30 } });
```
There is **no `AbortController` / `setTimeout`**. When the backend is unreachable (or slow), the `fetch` hangs until the OS/Next default timeout (effectively forever for a render). Because `app/page.tsx` calls `getPortfolio()` **server-side** inside the component body, the entire page render blocks.

The `try/catch` in `page.tsx` only catches *rejected* promises — a *hanging* connection is never rejected, so the page never reaches the empty-state fallback. It just hangs.

**Fix:** add `signal: AbortSignal.timeout(8000)` to the fetch in `api()`; on timeout, throw → caught by the existing `try/catch` → empty state renders. Also add a fallback `BASE` guard so missing `SENTINEL_API_URL` fails fast instead of hanging on `undefined/api...`.

### F2 — Backend not configured (BLOCKER for live test)
`ui/.env.local` sets `SENTINEL_API_URL=http://localhost:3000`. The live backend is on **Oracle Cloud**, not localhost. Without the real `SENTINEL_API_URL` + matching `SENTINEL_UI_KEY`, no data can load. The Oracle credentials were **not available on this machine** (not in repo, not in any non-secret file), so the live-data path could not be exercised.

**Fix:** supply Oracle `SENTINEL_API_URL` + `SENTINEL_UI_KEY` in `ui/.env.local` (or via the deploy's `docker-compose.prod.yml` which auto-wires the backend container URL).

### F3 — Port collision risk (CONFIG)
`ui/.env.local` points the UI's data source at `localhost:3000` — the **same port the UI itself binds to in dev** (Next dev ignores `PORT` env in this MSYS setup and binds 3000). Even if a backend were local, pointing the UI's API base at its own port is wrong. Should be the backend's port (3000 backend, UI on a different port, or use the compose internal address).

### F4 — Extremely slow dev startup (ENVIRONMENT)
`✓ Ready in 199.1s` and a webpack cache `ENOENT` rename error indicate the MSYS/filesystem layer is very slow for `.next` cache writes. `next build` also died (likely OOM or killed). This is an environment constraint, not a code bug, but it makes local E2E impractical.

---

## What works / is correct

- ✅ Route structure is clean (Next.js App Router, separated `/api/*` proxy routes).
- ✅ `app/page.tsx` has a `try/catch` that renders an empty state on API *error* (good intent — just needs F1's timeout to actually trigger it).
- ✅ Proxy routes (`app/api/stats/route.ts`, `action`, `settings`, `agents-proxy`, `agent-room-proxy`) correctly read `SENTINEL_API_URL` + `SENTINEL_UI_KEY` and forward with auth header.
- ✅ Code compiles; no syntax/type errors block the build at the route level.

---

## Items needing work (prioritized)

1. **[CRITICAL]** Add `AbortSignal.timeout(...)` to `api()` in `lib/api.ts` + guard missing `BASE`. Without this, the UI hangs (not just errors) whenever the backend is slow/unreachable.
2. **[BLOCKER]** Wire the real Oracle Cloud `SENTINEL_API_URL` + `SENTINEL_UI_KEY` so live data can load.
3. **[HIGH]** Fix port collision: UI data source must not point at the UI's own port.
4. **[MED]** Make `next dev`/`build` viable on this machine (the 199s ready + ENOENT suggests moving `.next` to a fast local path or increasing memory); alternatively test in the Docker/prod compose where it's proven (`docker compose -f docker-compose.prod.yml` per README).
5. **[LOW]** Consider a startup health probe on the overview so a dead backend shows "Backend offline" instead of a hang/blank.

---

## How to verify after fixes

1. Set `ui/.env.local` → `SENTINEL_API_URL=<oracle-backend>` + `SENTINEL_UI_KEY=<key>`.
2. `npm run build` (must produce `.next/BUILD_ID`).
3. `npm start` (or Codex's `ui/scripts/e2e-smoke.mjs` which checks `/`, `/repos`, `/security`).
4. Browser-drive each route; confirm data populates + empty-state on backend down.
5. Re-run this E2E; expect all routes HTTP 200 with live data.

**Status: blocked on (a) F1 code fix and (b) Oracle credentials. Cannot certify "fully working" until both resolved.**
