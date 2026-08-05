#!/bin/bash
# Polls origin/main and redeploys the self-hosted stack when it moves.
# Installed via cron on the Oracle deploy host — see docs/ORACLE_DEPLOY.md
# "Auto-deploy" section. Not run automatically anywhere else; run it in
# place from the repo checkout and cron it there (`crontab -e`) — it does
# not run in CI or locally.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.prod.yml"
LOG_DIR="$HOME/backups"
LOG_FILE="$LOG_DIR/deploy.log"
LOCK_FILE="/tmp/sentinel-auto-deploy.lock"

mkdir -p "$LOG_DIR"
log() { echo "$(date): $1" >> "$LOG_FILE"; }

# Skip this run instead of stacking up if a previous deploy (a `--build` can
# take a couple of minutes on a 1-CPU Oracle Free-tier VM) is still going.
if ! mkdir "$LOCK_FILE" 2>/dev/null; then
  log "SKIPPED - previous deploy still running (lock present)"
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

git fetch origin main --quiet

LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse origin/main)"

if [ "$LOCAL_SHA" = "$REMOTE_SHA" ]; then
  exit 0
fi

log "DEPLOYING - $LOCAL_SHA -> $REMOTE_SHA"

if ! git merge --ff-only origin/main >> "$LOG_FILE" 2>&1; then
  log "FAILED - git merge --ff-only failed (local main has diverged from origin/main)"
  exit 1
fi

if ! docker compose -f "$COMPOSE_FILE" up -d --build >> "$LOG_FILE" 2>&1; then
  log "FAILED - docker compose up --build failed at $(git rev-parse HEAD)"
  exit 1
fi

log "OK - now running $(git rev-parse --short HEAD)"
