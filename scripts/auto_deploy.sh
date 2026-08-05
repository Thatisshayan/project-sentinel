#!/bin/bash
# Polls origin/main and redeploys the self-hosted stack when it moves.
# Installed via cron on the Oracle deploy host — see docs/ORACLE_DEPLOY.md
# "Auto-deploy" section. Not run automatically anywhere else; run it in
# place from the repo checkout and cron it there (`crontab -e`) — it does
# not run in CI or locally.
#
# Images are built in CI (.github/workflows/publish.yml) and pushed to GHCR
# — this script only ever pulls them, never builds. Building backend/ui in
# place on a 1 OCPU / 1GB Oracle Free-tier host starves the live containers
# of CPU/memory badly enough to cause real request timeouts while it runs
# (confirmed live on 2026-08-05).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.prod.yml"
LOG_DIR="$HOME/backups"
LOG_FILE="$LOG_DIR/deploy.log"
LOCK_FILE="/tmp/sentinel-auto-deploy.lock"

mkdir -p "$LOG_DIR"
log() { echo "$(date): $1" >> "$LOG_FILE"; }

# Skip this run instead of stacking up if a previous run is still going.
if ! mkdir "$LOCK_FILE" 2>/dev/null; then
  log "SKIPPED - previous run still in progress (lock present)"
  exit 0
fi
trap 'rmdir "$LOCK_FILE" 2>/dev/null' EXIT

cd "$SCRIPT_DIR"

# Never deploy over local changes — a dirty checkout on the deploy host
# means someone is mid-debug there; back off instead of clobbering it.
if [ -n "$(git status --porcelain)" ]; then
  log "SKIPPED - working tree has local changes, refusing to deploy over them"
  exit 0
fi

BEFORE_SHA="$(git rev-parse HEAD)"
git fetch origin main --quiet

if [ "$BEFORE_SHA" != "$(git rev-parse origin/main)" ]; then
  # Keeps docker-compose.prod.yml, Caddyfile, and this script itself current
  # — the images themselves come from GHCR, not this checkout.
  if ! git merge --ff-only origin/main >> "$LOG_FILE" 2>&1; then
    log "FAILED - git merge --ff-only failed (local main has diverged from origin/main)"
    exit 1
  fi
  log "Repo checkout updated: $BEFORE_SHA -> $(git rev-parse HEAD)"
fi

# `docker compose pull` on an unchanged tag is a fast, cheap no-op (a
# digest check, not a rebuild) — safe to run unconditionally every tick
# instead of trying to predict whether CI has finished publishing yet.
BEFORE_IDS="$(docker compose -f "$COMPOSE_FILE" images -q backend ui 2>/dev/null)"

if ! docker compose -f "$COMPOSE_FILE" pull --quiet backend ui >> "$LOG_FILE" 2>&1; then
  log "FAILED - docker compose pull failed"
  exit 1
fi

AFTER_IDS="$(docker compose -f "$COMPOSE_FILE" images -q backend ui 2>/dev/null)"

if [ "$BEFORE_IDS" = "$AFTER_IDS" ]; then
  exit 0
fi

log "DEPLOYING - new image(s) pulled"

if ! docker compose -f "$COMPOSE_FILE" up -d >> "$LOG_FILE" 2>&1; then
  log "FAILED - docker compose up -d failed after pulling new image(s)"
  exit 1
fi

log "OK - now running $(git rev-parse --short HEAD)"
