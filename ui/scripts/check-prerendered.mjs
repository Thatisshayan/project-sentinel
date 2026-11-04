// Runs after every `next build` (npm "postbuild"). Fails if a page that shows
// backend data was prerendered at build time. The Docker build has no
// backend URL, so a prerendered page is saved with the "could not reach the
// API" error and served to every visitor. This took down /agents, /sprint,
// /security and /connectors in production (found 2026-11-04).
import { readFileSync } from 'node:fs';

// Pages that are safe to prerender: client components that fetch in the
// browser, and static assets.
const STATIC_OK = new Set(['/_not-found', '/agent-room', '/settings', '/favicon.ico']);

const manifest = JSON.parse(readFileSync('.next/prerender-manifest.json', 'utf8'));
const prerendered = Object.keys(manifest.routes ?? {});
const bad = prerendered.filter((route) => !STATIC_OK.has(route));

if (bad.length) {
  console.error(
    `\nThese pages were prerendered at build time: ${bad.join(', ')}\n` +
    'If a page loads backend data on the server, add `export const dynamic = "force-dynamic";` to it.\n' +
    'If it is static on purpose, add it to STATIC_OK in ui/scripts/check-prerendered.mjs.',
  );
  process.exit(1);
}
console.log(`check-prerendered: OK (static pages: ${prerendered.join(', ') || 'none'})`);
