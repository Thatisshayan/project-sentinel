#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "Usage: bash scripts/update_env_key.sh <env-file> <KEY> <VALUE>" >&2
  exit 1
fi

ENV_FILE="$1"
KEY="$2"
VALUE="$3"

if [ ! -f "$ENV_FILE" ]; then
  echo "Env file not found: $ENV_FILE" >&2
  exit 1
fi

TMP_FILE="$(mktemp "${TMPDIR:-/tmp}/env-update.XXXXXX")"
BACKUP_FILE="${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"

cp "$ENV_FILE" "$BACKUP_FILE"

awk -v key="$KEY" -v value="$VALUE" '
  BEGIN { updated = 0 }
  $0 ~ "^[[:space:]]*" key "=" {
    print key "=" value
    updated = 1
    next
  }
  { print }
  END {
    if (!updated) print key "=" value
  }
' "$ENV_FILE" > "$TMP_FILE"

mv "$TMP_FILE" "$ENV_FILE"
echo "Updated $KEY in $ENV_FILE"
echo "Backup: $BACKUP_FILE"
