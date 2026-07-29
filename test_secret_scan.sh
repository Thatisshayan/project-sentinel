#!/usr/bin/env bash
# Smoke test for the secret-scan regex used in scripts/verify.sh: this
# should find nothing in a clean checkout. grep exits 0 when it FINDS a
# match and 1 when it finds none — the opposite of what "test passed"
# should mean here, so map that explicitly instead of masking every exit
# code with `|| true` (which made this script report success even when a
# potential secret was actually found).
grep -rIlE "(API_KEY|SECRET|PRIVATE_KEY|TOKEN|PASSWORD)[[:space:]]*[=:][[:space:]]*[\"'][A-Za-z0-9/+_-]{8,}[\"']" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=audits/private \
  --exclude-dir=.venv --exclude-dir=_repo_clone --exclude-dir=dist --exclude-dir=build \
  --exclude-dir=.cache --exclude-dir=coverage \
  --exclude-dir=test --exclude-dir=tests --exclude-dir=__tests__ \
  --exclude="*.env" \
  --include="*.ts" --include="*.js" --include="*.py" .
status=$?

if [ "$status" -eq 0 ]; then
  echo "FAIL: potential secret(s) found by the scan regex above" >&2
  exit 1
elif [ "$status" -eq 1 ]; then
  echo "OK: no potential secrets found"
  exit 0
else
  echo "ERROR: grep exited with status $status" >&2
  exit "$status"
fi
