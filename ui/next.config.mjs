import path from "node:path";
import { fileURLToPath } from "node:url";

// Pin file tracing to this ui/ folder. Pointing it at the parent folder
// (as an Aug 2026 change did, likely to silence Next's "multiple lockfiles"
// warning on a dev machine) makes Next nest the standalone output under the
// folder's own name. In Docker the parent of /app is /, so server.js landed
// at /app/app/server.js and `node server.js` crashed: the production
// dashboard was down for ~5 weeks.
const uiRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: uiRoot,
};

export default nextConfig;
