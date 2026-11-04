#!/bin/bash
# Backs up the self-hosted Postgres container's 'sentinel' database.
# Installed via cron on the Oracle deploy host — see docs/ORACLE_DEPLOY.md
# "Backups" section. Not run automatically anywhere else; run it in place
# from the repo checkout and cron it there (`crontab -e`) — it does not run
# in CI or locally.
set -euo pipefail

# Run via `docker compose exec` against the actual compose file, not a
# hardcoded container name (e.g. 'project-sentinel-postgres-1') — that name
# is generated from the Compose project name/directory and breaks under a
# different checkout directory or COMPOSE_PROJECT_NAME. Confirmed as a real
# portability bug by CodeRabbit + Qodo independently (2026-07-29).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.prod.yml"

BACKUP_DIR="$HOME/backups"
STAMP=$(date +%F_%H%M%S)
FILE="$BACKUP_DIR/sentinel_${STAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

if ! docker compose -f "$COMPOSE_FILE" exec -T postgres pg_dump -U sentinel sentinel | gzip > "$FILE"; then
  echo "$(date): backup FAILED - pg_dump/compose exec returned non-zero" >> "$BACKUP_DIR/backup.log"
  rm -f "$FILE"
  exit 1
fi

if [ ! -s "$FILE" ]; then
  echo "$(date): backup FAILED - empty output file" >> "$BACKUP_DIR/backup.log"
  rm -f "$FILE"
  exit 1
fi

echo "$(date): backup OK -> $FILE ($(du -h "$FILE" | cut -f1))" >> "$BACKUP_DIR/backup.log"

# Keep 14 days of daily backups
find "$BACKUP_DIR" -name "sentinel_*.sql.gz" -mtime +14 -delete
