# ── Build stage ─────────────────────────────────────────────────────────────
# Compiles TypeScript (src/**/*.ts -> dist/**/*.js). Needs devDependencies
# (typescript, @swc/core, etc.) which the runtime stage below deliberately
# does not install.
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src/ ./src/
COPY migrations/ ./migrations/
RUN npm run build

# ── Runtime stage ───────────────────────────────────────────────────────────
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293

# Install Python and pip for Aider
RUN apk add --no-cache python3 py3-pip git

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Install Claude Code CLI for Phase 3 audit and task execution
RUN npm install -g @anthropic-ai/claude-code

# Install Aider — install to /usr/local so the non-root sentinel user can reach it
RUN pip3 install aider-install --break-system-packages \
  && aider-install \
  && ln -sf /root/.local/bin/aider /usr/local/bin/aider \
  || pip3 install aider-chat --break-system-packages

# Verify aider is reachable system-wide before we switch users
RUN aider --version || (echo "ERROR: aider not found after install" && exit 1)

# Aider (via litellm) retries a rate-limited/busy model in-place with
# exponential backoff for up to RETRY_TIMEOUT=60s (aider/models.py) before
# giving up — on a busy free-tier model that's up to a minute stuck on one
# model per attempt before builderRouter.ts's fallback chain ever gets a
# chance to move to the next one. Patched down to 1s (~3 quick retries,
# ~1.75s total) so it fails fast and hands control back to our own
# multi-model fallback logic instead of buffering on a single model.
RUN AIDER_MODELS_PY=$(python3 -c "import aider.models, os; print(os.path.abspath(aider.models.__file__))") \
  && sed -i 's/^RETRY_TIMEOUT = 60$/RETRY_TIMEOUT = 1/' "$AIDER_MODELS_PY" \
  && grep -q '^RETRY_TIMEOUT = 1$' "$AIDER_MODELS_PY" \
  || (echo "ERROR: failed to patch aider's RETRY_TIMEOUT" && exit 1)

# Limit Node.js heap to prevent OOM kills (Railway default ~512MB)
ENV NODE_OPTIONS="--max-old-space-size=256"

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/migrations ./migrations

RUN addgroup -S sentinel && adduser -S sentinel -G sentinel
USER sentinel

EXPOSE 3000

HEALTHCHECK \
  --interval=60s \
  --timeout=30s \
  --start-period=60s \
  --retries=5 \
  CMD node -e "require('http').get('http://localhost:3000/health',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1));"

CMD ["node", "dist/index.js"]
