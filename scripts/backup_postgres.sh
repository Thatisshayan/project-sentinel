#!/bin/bash
# Backs up the self-hosted Postgres container's 'sentinel' database.
# Installed via cron on the Oracle deploy host — see docs/ORACLE_DEPLOY.md
# "Backups" section. Not run automatically anywhere else; copy to the VM
# and cron it there (`crontab -e`), it does not run in CI or locally.
set -euo pipefail

BACKUP_DIR="$HOME/backups"
STAMP=$(date +%F_%H%M%S)
FILE="$BACKUP_DIR/sentinel_${STAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

docker exec project-sentinel-postgres-1 pg_dump -U sentinel sentinel | gzip > "$FILE"

if [ ! -s "$FILE" ]; then
  echo "$(date): backup FAILED - empty output file" >> "$BACKUP_DIR/backup.log"
  rm -f "$FILE"
  exit 1
fi

echo "$(date): backup OK -> $FILE ($(du -h "$FILE" | cut -f1))" >> "$BACKUP_DIR/backup.log"

# Keep 14 days of daily backups
find "$BACKUP_DIR" -name "sentinel_*.sql.gz" -mtime +14 -delete
